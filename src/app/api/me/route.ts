import { z } from "zod";
import { db } from "@/lib/db";
import { hashToken, requireSession, SESSION_COOKIE } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { notFound, ok, readJson, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const currentHash = token ? hashToken(token) : null;
  const [sessions, wallets] = await Promise.all([
    db.session.findMany({
      where: { userId: s.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, expiresAt: true, userAgent: true, chainId: true, tokenHash: true },
    }),
    db.walletIdentity.findMany({ where: { userId: s.userId }, select: { address: true, chainId: true, createdAt: true, lastSeenAt: true } }),
  ]);
  return ok({
    user: { id: s.user.id, displayName: s.user.displayName, role: s.user.role, createdAt: s.user.createdAt },
    wallets,
    sessions: sessions.map(({ tokenHash, ...rest }) => ({ ...rest, current: tokenHash === currentHash })),
  });
});

const patch = z.object({
  displayName: z
    .string()
    .trim()
    .max(32)
    .regex(/^[\w .-]*$/, "Letters, numbers, spaces, dots, dashes and underscores only")
    .transform((v) => v || null),
});

export const PATCH = route(async (req) => {
  const s = await requireSession();
  const { displayName } = await readJson(req, patch);
  const user = await db.user.update({ where: { id: s.userId }, data: { displayName } });
  return ok({ displayName: user.displayName });
});

const revoke = z.object({ sessionId: z.string().cuid() });

/** Revoke one of your other sessions. */
export const DELETE = route(async (req) => {
  const s = await requireSession();
  const { sessionId } = await readJson(req, revoke);
  const res = await db.session.updateMany({ where: { id: sessionId, userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!res.count) throw notFound("Session not found");
  return ok({ ok: true });
});
