import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { requireOwnedAgent } from "@/lib/server/agents";
import { ok, route, serialize } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Execution history with full traces — creator only. */
export const GET = route<Ctx>(async (req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await requireOwnedAgent(session, id);
  const take = Math.min(50, Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20);
  const items = await db.agentExecution.findMany({
    where: { agentId: id },
    orderBy: { queuedAt: "desc" },
    take,
    include: { steps: { orderBy: { index: "asc" } }, report: { select: { id: true, title: true } } },
  });
  return ok(serialize({ items }));
});
