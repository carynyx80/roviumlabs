import { issueNonce } from "@/lib/auth/siwe";
import { clientIp, ok, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const POST = route(async (req) => {
  await rateLimit(`nonce:${clientIp(req)}`, 30, 600);
  return ok({ nonce: await issueNonce() }, { headers: { "cache-control": "no-store" } });
});
