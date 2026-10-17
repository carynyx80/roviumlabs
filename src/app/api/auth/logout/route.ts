import { destroySession } from "@/lib/auth/session";
import { ok, route } from "@/lib/server/http";

export const POST = route(async () => {
  await destroySession();
  return ok({ ok: true });
});
