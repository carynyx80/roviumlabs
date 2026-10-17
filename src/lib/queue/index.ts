import { Prisma, type Job } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Durable job queue with two interchangeable drivers:
 *  - "bullmq":   Redis + BullMQ, used when REDIS_URL is set (recommended in production)
 *  - "postgres": a `Job` table claimed with FOR UPDATE SKIP LOCKED (no extra infrastructure)
 *
 * Execution state itself always lives in PostgreSQL (AgentExecution), so jobs only carry ids
 * and every handler is idempotent: re-delivering a job never produces a duplicate report.
 */

export type JobType = "research" | "monitor" | "stats";

export interface EnqueueOptions {
  type: JobType;
  payload: Record<string, unknown>;
  agentId?: string;
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

export const QUEUE_NAME = "rovium-agents";

export const queueDriver = (): "bullmq" | "postgres" => (process.env.REDIS_URL ? "bullmq" : "postgres");

let bullQueue: import("bullmq").Queue | undefined;

async function getBullQueue() {
  if (!bullQueue) {
    const { Queue } = await import("bullmq");
    const IORedis = (await import("ioredis")).default;
    const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    bullQueue = new Queue(QUEUE_NAME, { connection });
  }
  return bullQueue;
}

export async function enqueue(opts: EnqueueOptions): Promise<void> {
  if (queueDriver() === "bullmq") {
    const q = await getBullQueue();
    await q.add(
      opts.type,
      { ...opts.payload, agentId: opts.agentId },
      {
        jobId: opts.dedupeKey, // BullMQ ignores adds with an existing jobId → dedupe
        delay: opts.runAt ? Math.max(0, opts.runAt.getTime() - Date.now()) : 0,
        attempts: opts.maxAttempts ?? 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
    return;
  }
  // skipDuplicates → ON CONFLICT DO NOTHING on dedupeKey: re-enqueueing the same key is a no-op.
  await db.job.createMany({
    data: [
      {
        type: opts.type,
        payload: opts.payload as Prisma.InputJsonValue,
        agentId: opts.agentId,
        dedupeKey: opts.dedupeKey,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 3,
      },
    ],
    skipDuplicates: true,
  });
}

/** Postgres driver: atomically claims due jobs (and jobs whose lock expired after a crash). */
export async function claimJobs(workerId: string, limit: number, lockMs: number): Promise<Job[]> {
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedBy" = ${workerId},
      "lockedUntil" = now() + make_interval(secs => ${lockMs / 1000}::float8),
      "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'PENDING' AND "runAt" <= now())
         OR ("status" = 'RUNNING' AND "lockedUntil" < now())
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function completeJob(id: string) {
  await db.job.update({ where: { id }, data: { status: "DONE", lockedBy: null, lockedUntil: null } });
}

/** Exponential backoff: 30s, 60s, 120s... until maxAttempts, then FAILED. */
export async function failJob(job: Job, error: string, retryable: boolean) {
  const exhausted = !retryable || job.attempts >= job.maxAttempts;
  await db.job.update({
    where: { id: job.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      lastError: error.slice(0, 1000),
      lockedBy: null,
      lockedUntil: null,
      runAt: exhausted ? job.runAt : new Date(Date.now() + 30_000 * 2 ** Math.max(0, job.attempts - 1)),
    },
  });
  return exhausted;
}
