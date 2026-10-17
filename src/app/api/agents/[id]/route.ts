import { requireSession } from "@/lib/auth/session";
import { updateAgentSchema } from "@/lib/agents/validation";
import { applyAgentUpdate, requireOwnedAgent } from "@/lib/server/agents";
import { ok, readJson, route, serialize } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Full agent record for the owner (includes private configuration). */
export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const agent = await requireOwnedAgent(session, id);
  return ok(serialize(agent));
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const patch = await readJson(req, updateAgentSchema);
  const agent = await applyAgentUpdate(session, id, patch);
  return ok(serialize(agent));
});
