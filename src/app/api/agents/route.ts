import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createAgentSchema } from "@/lib/agents/validation";
import { createAgent } from "@/lib/server/agents";
import { listMarketplace } from "@/lib/server/queries";
import { ok, readJson, route, serialize } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const listQuery = z.object({
  q: z.string().max(80).optional(),
  specialization: z.enum(["GOLD", "TREASURIES", "REAL_ESTATE", "PRIVATE_CREDIT", "COMMODITIES", "MULTI_ASSET"]).optional(),
  sort: z.enum(["recent", "trending", "active", "name"]).optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
  pageSize: z.coerce.number().int().min(1).max(48).optional(),
  token: z.enum(["1"]).optional(),
});

/** Public marketplace listing. */
export const GET = route(async (req) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const q = listQuery.parse(params);
  const res = await listMarketplace({ ...q, tokenOnly: q.token === "1" });
  return ok(serialize(res));
});

/** Create an agent (creator only). */
export const POST = route(async (req) => {
  const session = await requireSession();
  await rateLimit(`create-agent:${session.userId}`, 10, 3600);
  const input = await readJson(req, createAgentSchema);
  const agent = await createAgent(session, input);
  return ok({ id: agent.id, slug: agent.slug, status: agent.status }, { status: 201 });
});
