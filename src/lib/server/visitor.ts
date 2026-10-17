import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const COOKIE = "rp_vid";

const sign = (id: string) => createHmac("sha256", env().SESSION_SECRET).update(id).digest("base64url").slice(0, 22);

/** Anonymous visitor id (HMAC-signed cookie) used to scope public chat history. */
export async function visitorId(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const [id, sig] = raw.split(".");
    if (id && sig) {
      const expected = sign(id);
      if (expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return id;
    }
  }
  if (!create) return null;
  const id = randomBytes(12).toString("base64url");
  jar.set(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return id;
}
