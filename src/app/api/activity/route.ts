import { recentActivity } from "@/lib/server/queries";
import { ok, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const before = sp.get("before");
  const items = await recentActivity({
    limit: Math.min(50, Number(sp.get("limit") ?? 30) || 30),
    agentId: sp.get("agentId") ?? undefined,
    before: before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined,
  });
  return ok({ items });
});
