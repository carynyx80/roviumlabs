/**
 * RoviumPad autonomous agent worker.
 *
 * A long-running Node process (not serverless). Responsibilities:
 *  - scheduler: turns due AgentSchedule rows into research executions / monitor jobs
 *  - consumer:  executes queued jobs (Postgres SKIP LOCKED queue, or BullMQ when REDIS_URL is set)
 *  - sweeper:   fails executions orphaned by crashed workers, prunes expired nonces/rate-limit rows
 *  - heartbeat + /healthz endpoint for orchestrators
 *  - graceful shutdown: stops claiming, lets in-flight jobs finish, releases locks
 *
 * Run: npm run worker   (uses tsx with the react-server condition so server-only modules load)
 */
import "dotenv/config";
import http from "node:http";
import os from "node:os";
import { randomBytes } from "node:crypto";
import type { Job } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { claimJobs, completeJob, enqueue, failJob, QUEUE_NAME, queueDriver } from "@/lib/queue";
import { runExecution, runMonitor, RetryableError } from "@/lib/agents/engine";
import { LifecycleError, requestExecution } from "@/lib/agents/lifecycle";
import { recomputeMarketStats } from "@/lib/agents/stats";

const cfg = env();
const WORKER_ID = `${os.hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
const DRIVER = queueDriver();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[worker]", ...a);
const errText = (e: unknown) =>
  e instanceof Error ? e.message.trim().split("\n").filter(Boolean).pop() || e.name : String(e);

let shuttingDown = false;
const running = new Set<Promise<unknown>>();
let jobsDone = 0;
let jobsFailed = 0;
const startedAt = new Date();

interface JobLike {
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

async function processJob(job: JobLike) {
  switch (job.type) {
    case "research": {
      const executionId = String(job.payload.executionId);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.EXECUTION_TIMEOUT_MS);
      try {
        const r = await runExecution(executionId, {
          signal: ctrl.signal,
          attempt: job.attempts,
          finalAttempt: job.attempts >= job.maxAttempts,
        });
        log("research", executionId, JSON.stringify(r));
      } finally {
        clearTimeout(timer);
      }
      return;
    }
    case "monitor": {
      const r = await runMonitor(String(job.payload.agentId));
      log("monitor", job.payload.agentId, r.triggered ? "triggered research" : "no threshold crossed");
      return;
    }
    case "stats": {
      const n = await recomputeMarketStats();
      log("stats recomputed for", n, "agents");
      return;
    }
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

// ── Scheduler ───────────────────────────────────────────────────
async function schedulerTick() {
  const now = new Date();
  const dueRuns = await db.agentSchedule.findMany({
    where: {
      mode: { in: ["SCHEDULED", "CONTINUOUS"] },
      nextRunAt: { lte: now },
      agent: { status: "ACTIVE", adminDisabled: false },
    },
    take: 50,
  });
  for (const s of dueRuns) {
    // Optimistic advance: only the worker that moves nextRunAt forward schedules the slot.
    const advanced = await db.agentSchedule.updateMany({
      where: { id: s.id, nextRunAt: s.nextRunAt },
      data: { nextRunAt: new Date(now.getTime() + s.intervalMinutes * 60_000) },
    });
    if (advanced.count !== 1) continue;
    try {
      await requestExecution({
        agentId: s.agentId,
        trigger: "SCHEDULED",
        reason: `Scheduled every ${s.intervalMinutes} minutes`,
        idempotencyKey: `sched:${s.agentId}:${s.nextRunAt!.toISOString()}`,
      });
    } catch (e) {
      if (!(e instanceof LifecycleError)) throw e;
      log("skip scheduled run", s.agentId, e.code);
    }
  }

  const dueMonitors = await db.agentSchedule.findMany({
    where: {
      mode: { in: ["EVENT_TRIGGERED", "CONTINUOUS"] },
      nextMonitorAt: { lte: now },
      agent: { status: "ACTIVE", adminDisabled: false },
    },
    take: 100,
  });
  for (const s of dueMonitors) {
    const advanced = await db.agentSchedule.updateMany({
      where: { id: s.id, nextMonitorAt: s.nextMonitorAt },
      data: { nextMonitorAt: new Date(now.getTime() + s.monitorMinutes * 60_000) },
    });
    if (advanced.count !== 1) continue;
    await enqueue({
      type: "monitor",
      payload: { agentId: s.agentId },
      agentId: s.agentId,
      dedupeKey: `monitor:${s.agentId}:${s.nextMonitorAt!.toISOString()}`,
      maxAttempts: 2,
    });
  }

  const bucket = Math.floor(Date.now() / (10 * 60_000));
  await enqueue({ type: "stats", payload: {}, dedupeKey: `stats:${bucket}`, maxAttempts: 1 });
}

async function sweeper() {
  const cutoff = new Date(Date.now() - cfg.EXECUTION_TIMEOUT_MS * 3);
  const orphaned = await db.agentExecution.findMany({
    where: {
      status: { in: ["RESEARCHING", "ANALYZING", "PUBLISHING"] },
      startedAt: { lt: cutoff },
    },
    select: { id: true },
  });
  for (const o of orphaned) {
    await db.agentExecution.updateMany({
      where: { id: o.id, status: { in: ["RESEARCHING", "ANALYZING", "PUBLISHING"] } },
      data: { status: "FAILED", finishedAt: new Date(), error: "Execution exceeded its time limit or its worker stopped" },
    });
  }
  const staleQueued = await db.agentExecution.updateMany({
    where: { status: "QUEUED", queuedAt: { lt: new Date(Date.now() - 6 * 3600_000) } },
    data: { status: "FAILED", finishedAt: new Date(), error: "Execution was not picked up within 6 hours" },
  });
  await db.authNonce.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400_000) } } });
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 2 * 86400_000) } } });
  await db.job.deleteMany({ where: { status: "DONE", updatedAt: { lt: new Date(Date.now() - 7 * 86400_000) } } });
  if (orphaned.length || staleQueued.count) log("sweeper failed", orphaned.length, "orphaned and", staleQueued.count, "stale executions");
}

async function heartbeat() {
  await db.workerHeartbeat.upsert({
    where: { id: WORKER_ID },
    create: { id: WORKER_ID, driver: DRIVER, startedAt, lastBeatAt: new Date(), jobsDone, jobsFailed },
    update: { lastBeatAt: new Date(), jobsDone, jobsFailed },
  });
}

// ── Postgres consumer ───────────────────────────────────────────
async function pgLoop() {
  while (!shuttingDown) {
    const free = cfg.WORKER_CONCURRENCY - running.size;
    if (free > 0) {
      const jobs = await claimJobs(WORKER_ID, free, cfg.EXECUTION_TIMEOUT_MS + 60_000).catch((e) => {
        log("claim failed", errText(e));
        return [] as Job[];
      });
      for (const job of jobs) {
        const p = (async () => {
          try {
            await processJob({ ...job, payload: job.payload as Record<string, unknown> });
            await completeJob(job.id);
            jobsDone++;
          } catch (e) {
            jobsFailed++;
            // Bookkeeping must never take the worker down (a failed write here once crashed the
            // process); the lock simply expires and another attempt reclaims the job.
            try {
              const msg = errText(e);
              const exhausted = await failJob(job, msg, e instanceof RetryableError || job.type !== "stats");
              log("job failed", job.type, job.id, exhausted ? "(final)" : "(will retry)", msg);
              if (exhausted && job.type === "research") {
                await db.agentExecution.updateMany({
                  where: { id: String((job.payload as { executionId?: string }).executionId), status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
                  data: { status: "FAILED", finishedAt: new Date(), error: msg.slice(0, 1000) },
                });
              }
            } catch (bookkeeping) {
              log("could not record job failure", job.id, errText(bookkeeping));
            }
          }
        })();
        running.add(p);
        void p.finally(() => running.delete(p));
      }
    }
    await new Promise((r) => setTimeout(r, running.size >= cfg.WORKER_CONCURRENCY ? 1000 : 2000));
  }
}

// ── BullMQ consumer ─────────────────────────────────────────────
async function startBull() {
  const { Worker } = await import("bullmq");
  const IORedis = (await import("ioredis")).default;
  const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processJob({
        type: job.name,
        payload: job.data as Record<string, unknown>,
        attempts: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      });
      jobsDone++;
    },
    { connection, concurrency: cfg.WORKER_CONCURRENCY, lockDuration: cfg.EXECUTION_TIMEOUT_MS + 60_000 },
  );
  worker.on("failed", (job, err) => {
    jobsFailed++;
    log("job failed", job?.name, job?.id, err.message);
  });
  return worker;
}

// ── Health endpoint ─────────────────────────────────────────────
function startHealthServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404).end();
      return;
    }
    let dbOk = true;
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    const body = { ok: dbOk && !shuttingDown, workerId: WORKER_ID, driver: DRIVER, running: running.size, jobsDone, jobsFailed, startedAt };
    res.writeHead(body.ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  server.listen(cfg.WORKER_HEALTH_PORT, () => log(`health endpoint on :${cfg.WORKER_HEALTH_PORT}/healthz`));
  return server;
}

async function main() {
  await db.$queryRaw`SELECT 1`;
  log(`starting ${WORKER_ID} driver=${DRIVER} concurrency=${cfg.WORKER_CONCURRENCY}`);
  const health = startHealthServer();
  await heartbeat();

  const timers = [
    setInterval(() => heartbeat().catch((e) => log("heartbeat failed", errText(e))), 15_000),
    setInterval(() => schedulerTick().catch((e) => log("scheduler failed", errText(e))), 20_000),
    setInterval(() => sweeper().catch((e) => log("sweeper failed", errText(e))), 5 * 60_000),
  ];
  schedulerTick().catch((e) => log("scheduler failed", errText(e)));
  sweeper().catch((e) => log("sweeper failed", errText(e)));

  const bull = DRIVER === "bullmq" ? await startBull() : undefined;
  const loop = DRIVER === "postgres" ? pgLoop() : Promise.resolve();

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, draining ${running.size} job(s)`);
    timers.forEach(clearInterval);
    await bull?.close();
    await Promise.race([Promise.allSettled([...running, loop]), new Promise((r) => setTimeout(r, 30_000))]);
    // Release any locks still held so another worker can pick the jobs up immediately.
    await db.job.updateMany({ where: { lockedBy: WORKER_ID, status: "RUNNING" }, data: { status: "PENDING", lockedBy: null, lockedUntil: null } });
    await db.workerHeartbeat.delete({ where: { id: WORKER_ID } }).catch(() => undefined);
    health.close();
    await db.$disconnect();
    log("stopped");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
