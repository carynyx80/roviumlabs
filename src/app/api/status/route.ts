import { db } from "@/lib/db";
import { llmConfigured } from "@/lib/env";
import { queueDriver } from "@/lib/queue";
import { networkStatus } from "@/lib/chain/status";

export const dynamic = "force-dynamic";

/** Public, read-only platform + network status (no secrets). */
export async function GET() {
  let database = false;
  let workersOnline = 0;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
    workersOnline = await db.workerHeartbeat.count({ where: { lastBeatAt: { gt: new Date(Date.now() - 60_000) } } });
  } catch {
    database = false;
  }
  const networks = await networkStatus();
  return Response.json(
    { platform: { database, workersOnline, queue: queueDriver(), llmConfigured: llmConfigured() }, networks, time: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
