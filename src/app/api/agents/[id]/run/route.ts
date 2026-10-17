import { requireSession } from "@/lib/auth/session";
import { LifecycleError, requestExecution } from "@/lib/agents/lifecycle";
import { requireOwnedAgent } from "@/lib/server/agents";
import { ApiError, ok, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** Manual "Run now" — creator only, rate limited, subject to the agent's daily run limit. */
export const POST = route<Ctx>(async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await requireOwnedAgent(session, id);
  await rateLimit(`run:${id}`, 6, 3600);
  try {
    const exec = await requestExecution({ agentId: id, trigger: "MANUAL", reason: "Run now (creator)", actor: session.address });
    return ok({ executionId: exec.id, status: exec.status }, { status: 202 });
  } catch (e) {
    if (e instanceof LifecycleError) throw new ApiError(409, e.code, e.message);
    throw e;
  }
});
