import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { forbidden, unauthorized } from "@/lib/server/http";

export const SESSION_COOKIE = "rp_session";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(opts: {
  userId: string;
  address: string;
  chainId: number;
  userAgent?: string | null;
}) {
  const token = randomBytes(32).toString("base64url");
  const ttlMs = env().SESSION_TTL_HOURS * 3600_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.session.create({
    data: {
      userId: opts.userId,
      tokenHash: hashToken(token),
      address: opts.address,
      chainId: opts.chainId,
      expiresAt,
      userAgent: opts.userAgent?.slice(0, 300),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.banned) {
    return null;
  }
  return session;
}

export type AuthedSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function requireSession(): Promise<AuthedSession> {
  const s = await getSession();
  if (!s) throw unauthorized();
  return s;
}

export async function requireAdmin(): Promise<AuthedSession> {
  const s = await requireSession();
  if (s.user.role !== "ADMIN") throw forbidden("Administrator access required");
  return s;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(SESSION_COOKIE);
}
