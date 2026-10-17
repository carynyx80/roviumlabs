import { db } from "@/lib/db";
import { llmConfigured } from "@/lib/env";
import { queueDriver } from "@/lib/queue";

export const dynamic = "force-dynamic";

/** Liveness/readiness for the web tier, including worker heartbeat visibility. */
export async function GET() {
  let database = false;
  let workers = 0;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
    workers = await db.workerHeartbeat.count({ where: { lastBeatAt: { gt: new Date(Date.now() - 60_000) } } });
  } catch {
    database = false;
  }
  const body = {
    ok: database,
    database,
    workersOnline: workers,
    queue: queueDriver(),
    llmConfigured: llmConfigured(),
    time: new Date().toISOString(),
  };
  return Response.json(body, { status: database ? 200 : 503, headers: { "cache-control": "no-store" } });
}
