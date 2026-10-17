import { getSession } from "@/lib/auth/session";
import { ok, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await getSession();
  return ok(
    {
      user: s
        ? { id: s.user.id, address: s.address, role: s.user.role, displayName: s.user.displayName, chainId: s.chainId }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
});
