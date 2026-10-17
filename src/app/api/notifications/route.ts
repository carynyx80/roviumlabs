import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { ok, readJson, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const session = await requireSession();
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.notification.count({ where: { userId: session.userId, readAt: null } }),
  ]);
  return ok({ items, unread });
});

const body = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().cuid()).max(100) }),
]);

export const POST = route(async (req) => {
  const session = await requireSession();
  const input = await readJson(req, body);
  await db.notification.updateMany({
    where: { userId: session.userId, readAt: null, ...("ids" in input ? { id: { in: input.ids } } : {}) },
    data: { readAt: new Date() },
  });
  return ok({ ok: true });
});
