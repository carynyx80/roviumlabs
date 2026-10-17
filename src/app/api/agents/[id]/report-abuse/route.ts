import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { PUBLIC_AGENT_WHERE } from "@/lib/server/queries";
import { conflict, notFound, ok, readJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ reason: z.string().trim().min(10).max(1000) });

export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await rateLimit(`abuse:${session.userId}`, 10, 86400);
  const agent = await db.agent.findFirst({ where: { id, ...PUBLIC_AGENT_WHERE }, select: { id: true } });
  if (!agent) throw notFound("Agent not found");
  const { reason } = await readJson(req, body);
  try {
    await db.agentAbuseReport.create({ data: { agentId: id, reporterId: session.userId, reason } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("You have already reported this agent");
    }
    throw e;
  }
  return ok({ ok: true }, { status: 201 });
});
