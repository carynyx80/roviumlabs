import "server-only";
import type { Prisma, RwaSpecialization } from "@prisma/client";
import { db } from "@/lib/db";

/** Agents visible publicly: activated at least once and not removed by moderation. */
export const PUBLIC_AGENT_WHERE: Prisma.AgentWhereInput = {
  status: { in: ["ACTIVE", "PAUSED"] },
  adminDisabled: false,
};

export const agentCardSelect = {
  id: true,
  slug: true,
  name: true,
  ticker: true,
  description: true,
  imageId: true,
  specialization: true,
  status: true,
  lastSuccessAt: true,
  lastRunAt: true,
  createdAt: true,
  activatedAt: true,
  tokenDeployments: {
    where: { status: "CONFIRMED" },
    select: { tokenSymbol: true, contractAddress: true, chainId: true },
    take: 1,
  },
  reports: {
    where: { hidden: false },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { riskLevel: true, riskScore: true, createdAt: true, title: true },
  },
  marketStats: { select: { trendingScore: true, reports7d: true, runs7d: true } },
} satisfies Prisma.AgentSelect;

export type AgentCardData = Prisma.AgentGetPayload<{ select: typeof agentCardSelect }>;

export type SortKey = "recent" | "trending" | "active" | "name";

export async function listMarketplace(opts: {
  q?: string;
  specialization?: RwaSpecialization;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
  tokenOnly?: boolean;
}) {
  const pageSize = Math.min(48, Math.max(1, opts.pageSize ?? 12));
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim().slice(0, 80);
  const where: Prisma.AgentWhereInput = {
    ...PUBLIC_AGENT_WHERE,
    ...(opts.specialization ? { specialization: opts.specialization } : {}),
    ...(opts.tokenOnly ? { tokenDeployments: { some: { status: "CONFIRMED" } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { ticker: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.AgentOrderByWithRelationInput[] =
    opts.sort === "trending"
      ? [{ marketStats: { trendingScore: "desc" } }, { lastSuccessAt: { sort: "desc", nulls: "last" } }]
      : opts.sort === "active"
        ? [{ marketStats: { runs7d: "desc" } }, { lastSuccessAt: { sort: "desc", nulls: "last" } }]
        : opts.sort === "name"
          ? [{ name: "asc" }]
          : [{ activatedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];

  const [items, total] = await Promise.all([
    db.agent.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: agentCardSelect }),
    db.agent.count({ where }),
  ]);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function platformActivityStats() {
  const since = new Date(Date.now() - 7 * 86400_000);
  const [agents, active, reports, reports7d, runs7d, tokens] = await Promise.all([
    db.agent.count({ where: PUBLIC_AGENT_WHERE }),
    db.agent.count({ where: { status: "ACTIVE", adminDisabled: false } }),
    db.researchReport.count({ where: { hidden: false } }),
    db.researchReport.count({ where: { hidden: false, createdAt: { gte: since } } }),
    db.agentExecution.count({ where: { queuedAt: { gte: since }, status: "COMPLETED" } }),
    db.tokenDeployment.count({ where: { status: "CONFIRMED" } }),
  ]);
  return { agents, active, reports, reports7d, runs7d, tokens };
}

export async function recentActivity(opts: { limit?: number; agentId?: string; before?: Date } = {}) {
  return db.activityEvent.findMany({
    where: {
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      OR: [{ agentId: null }, { agent: PUBLIC_AGENT_WHERE }],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, opts.limit ?? 30),
    include: { agent: { select: { slug: true, name: true, imageId: true } } },
  });
}

export async function getPublicAgent(slug: string) {
  return db.agent.findFirst({
    where: { slug, ...PUBLIC_AGENT_WHERE },
    include: {
      owner: { select: { id: true, displayName: true, wallets: { select: { address: true }, take: 1 } } },
      config: true,
      schedule: true,
      marketStats: true,
      tokenDeployments: { where: { status: "CONFIRMED" }, orderBy: { confirmedAt: "desc" } },
      monitoredAssets: { orderBy: { name: "asc" } },
      _count: { select: { reports: { where: { hidden: false } }, executions: true } },
    },
  });
}

export type PublicAgent = NonNullable<Awaited<ReturnType<typeof getPublicAgent>>>;
