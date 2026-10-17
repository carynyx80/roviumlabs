import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifySiwe } from "@/lib/auth/siwe";
import { createSession } from "@/lib/auth/session";
import { audit } from "@/lib/agents/events";
import { badRequest, clientIp, ok, readJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

const body = z.object({
  message: z.string().min(50).max(3000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid signature"),
});

export const POST = route(async (req) => {
  const ip = clientIp(req);
  await rateLimit(`verify:${ip}`, 20, 600);
  const { message, signature } = await readJson(req, body);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) throw badRequest("Missing host header");

  const { address, chainId } = await verifySiwe({ message, signature: signature as `0x${string}`, expectedHost: host });
  const lower = address.toLowerCase();
  const isAdmin = env().ADMIN_WALLETS.includes(lower);

  const user = await db.$transaction(async (tx) => {
    const wallet = await tx.walletIdentity.findUnique({ where: { address: lower }, include: { user: true } });
    if (wallet) {
      await tx.walletIdentity.update({ where: { id: wallet.id }, data: { lastSeenAt: new Date(), chainId } });
      if (isAdmin && wallet.user.role !== "ADMIN") {
        return tx.user.update({ where: { id: wallet.userId }, data: { role: "ADMIN" } });
      }
      return wallet.user;
    }
    return tx.user.create({
      data: { role: isAdmin ? "ADMIN" : "USER", wallets: { create: { address: lower, chainId } } },
    });
  });
  if (user.banned) throw badRequest("This account has been suspended");

  await createSession({ userId: user.id, address: lower, chainId, userAgent: req.headers.get("user-agent") });
  await audit(db, { actorId: user.id, action: "auth.sign_in", target: lower, ip });
  return ok({ ok: true });
});
