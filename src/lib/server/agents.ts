import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { slugify } from "@/lib/utils";
import type { AuthedSession } from "@/lib/auth/session";
import { badRequest, forbidden, notFound } from "./http";
import type { CreateAgentInput } from "@/lib/agents/validation";
import { recordEvent } from "@/lib/agents/events";
import { nextTimes, transitionAgent } from "@/lib/agents/lifecycle";
import { remember } from "@/lib/agents/memory";

/** Loads an agent and enforces ownership (or admin). Every creator-only route goes through this. */
export async function requireOwnedAgent(session: AuthedSession, agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId }, include: { config: true, schedule: true } });
  if (!agent) throw notFound("Agent not found");
  if (agent.ownerId !== session.userId && session.user.role !== "ADMIN") throw forbidden("Only the agent's creator can do this");
  return agent;
}

async function uniqueSlug(name: string) {
  const base = slugify(name) || "agent";
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const exists = await db.agent.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export async function createAgent(session: AuthedSession, input: CreateAgentInput) {
  const owned = await db.agent.count({ where: { ownerId: session.userId, status: { not: "DISABLED" } } });
  if (owned >= env().MAX_ACTIVE_AGENTS_PER_USER) {
    throw badRequest(`You can have at most ${env().MAX_ACTIVE_AGENTS_PER_USER} agents. Disable one to create another.`);
  }
  if (input.identity.imageId) {
    const media = await db.media.findUnique({ where: { id: input.identity.imageId }, select: { ownerId: true } });
    if (!media || media.ownerId !== session.userId) throw badRequest("Invalid agent image");
  }
  if (input.intelligence.dataSources.includes("web") && !input.intelligence.customSourceUrls.length) {
    throw badRequest("Add at least one https URL or deselect 'Creator-specified web pages'");
  }

  const slug = await uniqueSlug(input.identity.name);
  const agent = await db.$transaction(async (tx) => {
    const a = await tx.agent.create({
      data: {
        slug,
        ownerId: session.userId,
        name: input.identity.name,
        ticker: input.identity.ticker,
        description: input.identity.description,
        imageId: input.identity.imageId ?? null,
        specialization: input.identity.specialization,
        objectives: input.identity.objectives,
        config: {
          create: {
            researchObjectives: input.intelligence.researchObjectives,
            dataSources: input.intelligence.dataSources,
            customSourceUrls: input.intelligence.customSourceUrls,
            focusAssets: input.intelligence.focusAssets,
            riskSensitivity: input.intelligence.riskSensitivity,
            reportingStyle: input.intelligence.reportingStyle,
            monitoringCriteria: input.intelligence.monitoringCriteria,
          },
        },
        schedule: {
          create: {
            mode: input.autonomy.mode,
            intervalMinutes: input.autonomy.intervalMinutes,
            monitorMinutes: input.autonomy.monitorMinutes,
          },
        },
      },
    });
    await recordEvent(tx, {
      type: "AGENT_CREATED",
      agentId: a.id,
      actor: session.address,
      message: `${a.name} ($${a.ticker}) was created`,
    });
    return a;
  });

  await remember(agent.id, [
    ...input.identity.objectives.map((o) => ({ kind: "OBJECTIVE" as const, content: o, importance: 3 })),
    ...input.intelligence.researchObjectives.map((o) => ({ kind: "OBJECTIVE" as const, content: o, importance: 3 })),
  ]).catch(() => undefined);

  if (input.activate) await transitionAgent(agent.id, "activate", session.address);
  return db.agent.findUniqueOrThrow({ where: { id: agent.id } });
}

export async function applyAgentUpdate(
  session: AuthedSession,
  agentId: string,
  patch: {
    description?: string;
    imageId?: string | null;
    objectives?: string[];
    intelligence?: Partial<CreateAgentInput["intelligence"]>;
    autonomy?: Partial<CreateAgentInput["autonomy"]>;
    limits?: { dailySpendLimitUsd?: number; dailyRunLimit?: number };
  },
) {
  const agent = await requireOwnedAgent(session, agentId);
  if (agent.adminDisabled) throw forbidden("This agent was disabled by an administrator");
  if (patch.imageId) {
    const media = await db.media.findUnique({ where: { id: patch.imageId }, select: { ownerId: true } });
    if (!media || media.ownerId !== agent.ownerId) throw badRequest("Invalid agent image");
  }
  const changes: string[] = [];
  await db.$transaction(async (tx) => {
    const agentData: Prisma.AgentUpdateInput = {};
    if (patch.description !== undefined) {
      agentData.description = patch.description;
      changes.push("description");
    }
    if (patch.imageId !== undefined) {
      agentData.image = patch.imageId ? { connect: { id: patch.imageId } } : { disconnect: true };
      changes.push("image");
    }
    if (patch.objectives) {
      agentData.objectives = patch.objectives;
      changes.push("objectives");
    }
    if (Object.keys(agentData).length) await tx.agent.update({ where: { id: agentId }, data: agentData });

    if (patch.intelligence && Object.keys(patch.intelligence).length) {
      const i = patch.intelligence;
      const sources = i.dataSources ?? agent.config?.dataSources ?? [];
      const urls = i.customSourceUrls ?? agent.config?.customSourceUrls ?? [];
      if (sources.includes("web") && !urls.length) throw badRequest("Add at least one https URL or deselect web pages");
      await tx.agentConfig.update({
        where: { agentId },
        data: {
          ...(i.researchObjectives ? { researchObjectives: i.researchObjectives } : {}),
          ...(i.dataSources ? { dataSources: i.dataSources } : {}),
          ...(i.customSourceUrls ? { customSourceUrls: i.customSourceUrls } : {}),
          ...(i.focusAssets ? { focusAssets: i.focusAssets } : {}),
          ...(i.riskSensitivity ? { riskSensitivity: i.riskSensitivity } : {}),
          ...(i.reportingStyle ? { reportingStyle: i.reportingStyle } : {}),
          ...(i.monitoringCriteria ? { monitoringCriteria: i.monitoringCriteria } : {}),
          version: { increment: 1 },
        },
      });
      changes.push(...Object.keys(i));
    }
    if (patch.limits && Object.keys(patch.limits).length) {
      await tx.agentConfig.update({
        where: { agentId },
        data: {
          ...(patch.limits.dailySpendLimitUsd !== undefined ? { dailySpendLimitUsd: patch.limits.dailySpendLimitUsd } : {}),
          ...(patch.limits.dailyRunLimit !== undefined ? { dailyRunLimit: patch.limits.dailyRunLimit } : {}),
        },
      });
      changes.push("limits");
    }
    if (patch.autonomy && Object.keys(patch.autonomy).length && agent.schedule) {
      const merged = { ...agent.schedule, ...patch.autonomy };
      const times = agent.status === "ACTIVE" ? nextTimes(merged) : { nextRunAt: null, nextMonitorAt: null };
      await tx.agentSchedule.update({
        where: { agentId },
        data: { mode: merged.mode, intervalMinutes: merged.intervalMinutes, monitorMinutes: merged.monitorMinutes, ...times },
      });
      changes.push("schedule");
    }
  });
  if (changes.length) {
    await remember(agentId, [
      { kind: "CONFIG_CHANGE", content: `Creator updated: ${[...new Set(changes)].join(", ")}`, data: { changes }, importance: 2 },
    ]).catch(() => undefined);
  }
  return db.agent.findUniqueOrThrow({ where: { id: agentId }, include: { config: true, schedule: true } });
}
