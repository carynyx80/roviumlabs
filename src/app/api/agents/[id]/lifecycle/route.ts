import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { LifecycleError, transitionAgent } from "@/lib/agents/lifecycle";
import { requireOwnedAgent } from "@/lib/server/agents";
import { ApiError, ok, readJson, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ action: z.enum(["activate", "pause", "resume", "disable"]) });

export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await requireOwnedAgent(session, id);
  const { action } = await readJson(req, body);
  try {
    const agent = await transitionAgent(id, action, session.address);
    return ok({ id: agent.id, status: agent.status });
  } catch (e) {
    if (e instanceof LifecycleError) throw new ApiError(409, e.code, e.message);
    throw e;
  }
});
