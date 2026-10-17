import { Prisma, type Agent, type AgentSchedule, type ExecutionTrigger } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { recordEvent } from "./events";
import { EXECUTION_ACTIVE } from "./constants";

export class LifecycleError extends Error {
  constructor(
    public code: "NOT_ACTIVE" | "ALREADY_RUNNING" | "DAILY_LIMIT" | "INVALID_TRANSITION" | "DISABLED",
    message: string,
  ) {
    super(message);
  }
}

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export function nextTimes(schedule: Pick<AgentSchedule, "mode" | "intervalMinutes" | "monitorMinutes">, from = new Date()) {
  const runs = schedule.mode === "SCHEDULED" || schedule.mode === "CONTINUOUS";
  const monitors = schedule.mode === "EVENT_TRIGGERED" || schedule.mode === "CONTINUOUS";
  return {
    nextRunAt: runs ? new Date(from.getTime() + schedule.intervalMinutes * 60_000) : null,
    nextMonitorAt: monitors ? new Date(from.getTime() + schedule.monitorMinutes * 60_000) : null,
  };
}

/**
 * Creates an execution and enqueues it. Concurrency is enforced by a partial unique
 * index (one in-flight execution per agent); the daily run limit guards against runaway
 * triggers. Idempotency keys make scheduled slots and event triggers safe to re-submit.
 */
export interface ExecutionRequest {
  agentId: string;
  trigger: ExecutionTrigger;
  reason?: string;
  idempotencyKey?: string;
  actor?: string;
}

export async function requestExecution(opts: ExecutionRequest) {
  return (await requestExecutionDetailed(opts)).execution;
}

/** Like requestExecution, but reports whether a new execution was created or an existing one reused. */
export async function requestExecutionDetailed(opts: ExecutionRequest) {
  const agent = await db.agent.findUnique({ where: { id: opts.agentId }, include: { config: true } });
  if (!agent) throw new LifecycleError("NOT_ACTIVE", "Agent not found");
  if (agent.adminDisabled || agent.status === "DISABLED") throw new LifecycleError("DISABLED", "Agent is disabled");
  if (agent.status !== "ACTIVE") throw new LifecycleError("NOT_ACTIVE", "Activate the agent before running research");

  const runsToday = await db.agentExecution.count({
    where: { agentId: agent.id, queuedAt: { gte: startOfUtcDay() }, status: { not: "CANCELLED" } },
  });
  const limit = agent.config?.dailyRunLimit ?? 6;
  if (runsToday >= limit) {
    throw new LifecycleError("DAILY_LIMIT", `Daily run limit reached (${limit} runs per UTC day)`);
  }

  const key = opts.idempotencyKey ?? `${opts.trigger.toLowerCase()}:${agent.id}:${Date.now()}`;
  let execution;
  try {
    execution = await db.agentExecution.create({
      data: { agentId: agent.id, trigger: opts.trigger, triggerReason: opts.reason?.slice(0, 300), idempotencyKey: key },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = String((err.meta as { target?: unknown })?.target ?? "");
      if (target.includes("idempotencyKey")) {
        return { execution: await db.agentExecution.findUniqueOrThrow({ where: { idempotencyKey: key } }), created: false };
      }
      throw new LifecycleError("ALREADY_RUNNING", "A research run is already in progress for this agent");
    }
    // raw partial index violation surfaces as unique violation without Prisma target metadata
    if (err instanceof Error && /AgentExecution_one_active_per_agent/.test(err.message)) {
      throw new LifecycleError("ALREADY_RUNNING", "A research run is already in progress for this agent");
    }
    throw err;
  }
  await enqueue({
    type: "research",
    payload: { executionId: execution.id },
    agentId: agent.id,
    dedupeKey: `exec:${execution.id}`,
    maxAttempts: 3,
  });
  return { execution, created: true };
}

export async function hasActiveExecution(agentId: string) {
  return (
    (await db.agentExecution.count({ where: { agentId, status: { in: [...EXECUTION_ACTIVE] } } })) > 0
  );
}

type Transition = "activate" | "pause" | "resume" | "disable";

const ALLOWED: Record<Transition, Agent["status"][]> = {
  activate: ["DRAFT"],
  pause: ["ACTIVE"],
  resume: ["PAUSED"],
  disable: ["DRAFT", "ACTIVE", "PAUSED"],
};

export async function transitionAgent(agentId: string, action: Transition, actor: string) {
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId }, include: { schedule: true } });
  if (agent.adminDisabled) throw new LifecycleError("DISABLED", "This agent was disabled by an administrator");
  if (!ALLOWED[action].includes(agent.status)) {
    throw new LifecycleError("INVALID_TRANSITION", `Cannot ${action} an agent that is ${agent.status.toLowerCase()}`);
  }
  const now = new Date();
  const schedule = agent.schedule ?? { mode: "MANUAL" as const, intervalMinutes: 360, monitorMinutes: 30 };

  const updated = await db.$transaction(async (tx) => {
    if (action === "activate" || action === "resume") {
      const times = nextTimes(schedule, now);
      await tx.agentSchedule.update({ where: { agentId }, data: times });
      const a = await tx.agent.update({
        where: { id: agentId },
        data: { status: "ACTIVE", activatedAt: agent.activatedAt ?? now },
      });
      await recordEvent(tx, {
        type: action === "activate" ? "AGENT_ACTIVATED" : "AGENT_RESUMED",
        agentId,
        actor,
        message: `${agent.name} was ${action === "activate" ? "activated" : "resumed"}`,
      });
      return a;
    }
    await tx.agentSchedule.update({ where: { agentId }, data: { nextRunAt: null, nextMonitorAt: null } });
    // Queued runs that have not started are cancelled; in-flight runs are asked to stop.
    await tx.agentExecution.updateMany({
      where: { agentId, status: "QUEUED" },
      data: { status: "CANCELLED", finishedAt: now, error: `Agent ${action}d` },
    });
    await tx.agentExecution.updateMany({
      where: { agentId, status: { in: ["RESEARCHING", "ANALYZING", "PUBLISHING"] } },
      data: { cancelRequested: true },
    });
    const a = await tx.agent.update({
      where: { id: agentId },
      data: { status: action === "pause" ? "PAUSED" : "DISABLED" },
    });
    await recordEvent(tx, {
      type: action === "pause" ? "AGENT_PAUSED" : "AGENT_DISABLED",
      agentId,
      actor,
      message: `${agent.name} was ${action === "pause" ? "paused" : "disabled"}`,
    });
    return a;
  });

  // First activation produces an initial report regardless of mode, so the agent has research to show.
  if (action === "activate") {
    await requestExecution({
      agentId,
      trigger: "MANUAL",
      reason: "Initial research on activation",
      idempotencyKey: `activation:${agentId}`,
      actor,
    }).catch(() => undefined);
  }
  return updated;
}
