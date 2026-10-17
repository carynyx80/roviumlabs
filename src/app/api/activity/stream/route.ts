import { db } from "@/lib/db";
import { PUBLIC_AGENT_WHERE } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of new platform events. The server polls PostgreSQL every
 * 3 seconds for rows newer than the last delivered one and pushes them to the client.
 * Streams close after 5 minutes; EventSource reconnects automatically with Last-Event-ID.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const lastId = req.headers.get("last-event-id");
  let cursor = new Date();
  if (lastId) {
    const last = await db.activityEvent.findUnique({ where: { id: lastId }, select: { createdAt: true } }).catch(() => null);
    if (last) cursor = last.createdAt;
  }

  const encoder = new TextEncoder();
  let closed = false;
  req.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(encoder.encode(s));
      };
      send("retry: 5000\n\n");
      const started = Date.now();
      while (!closed && Date.now() - started < 5 * 60_000) {
        try {
          const rows = await db.activityEvent.findMany({
            where: {
              createdAt: { gt: cursor },
              ...(agentId ? { agentId } : {}),
              OR: [{ agentId: null }, { agent: PUBLIC_AGENT_WHERE }],
            },
            orderBy: { createdAt: "asc" },
            take: 50,
            include: { agent: { select: { slug: true, name: true, imageId: true } } },
          });
          for (const r of rows) {
            send(`id: ${r.id}\nevent: activity\ndata: ${JSON.stringify(r)}\n\n`);
            cursor = r.createdAt;
          }
          send(": keep-alive\n\n");
        } catch {
          send('event: unavailable\ndata: {"message":"temporarily unavailable"}\n\n');
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
