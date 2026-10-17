import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { draftSchema } from "@/lib/agents/validation";
import { notFound, ok, readJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

/** Agent creation drafts are persisted server-side so progress survives reloads and devices. */
export const GET = route(async () => {
  const session = await requireSession();
  const draft = await db.agentDraft.findFirst({ where: { ownerId: session.userId }, orderBy: { updatedAt: "desc" } });
  return ok({ draft });
});

export const PUT = route(async (req) => {
  const session = await requireSession();
  await rateLimit(`draft:${session.userId}`, 240, 3600);
  const input = await readJson(req, draftSchema);
  if (input.id) {
    const existing = await db.agentDraft.findUnique({ where: { id: input.id } });
    if (!existing || existing.ownerId !== session.userId) throw notFound("Draft not found");
    const draft = await db.agentDraft.update({
      where: { id: input.id },
      data: { data: input.data as Prisma.InputJsonValue, step: input.step },
    });
    return ok({ draft });
  }
  const draft = await db.agentDraft.create({
    data: { ownerId: session.userId, data: input.data as Prisma.InputJsonValue, step: input.step },
  });
  return ok({ draft }, { status: 201 });
});

export const DELETE = route(async () => {
  const session = await requireSession();
  await db.agentDraft.deleteMany({ where: { ownerId: session.userId } });
  return ok({ ok: true });
});
