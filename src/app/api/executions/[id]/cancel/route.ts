import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { requireOwnedAgent } from "@/lib/server/agents";
import { badRequest, notFound, ok, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const exec = await db.agentExecution.findUnique({ where: { id }, select: { agentId: true, status: true } });
  if (!exec) throw notFound("Execution not found");
  await requireOwnedAgent(session, exec.agentId);
  if (exec.status === "QUEUED") {
    await db.agentExecution.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date(), error: "Cancelled by creator" } });
    return ok({ status: "CANCELLED" });
  }
  if (["RESEARCHING", "ANALYZING", "PUBLISHING"].includes(exec.status)) {
    await db.agentExecution.update({ where: { id }, data: { cancelRequested: true } });
    return ok({ status: "CANCEL_REQUESTED" });
  }
  throw badRequest("This execution has already finished");
});
