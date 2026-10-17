import Link from "next/link";
import type { Metadata } from "next";
import { Bot, SearchX } from "lucide-react";
import { z } from "zod";
import { AgentCard } from "@/components/agents/agent-bits";
import { ExploreFilters } from "@/components/agents/explore-filters";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { listMarketplace } from "@/lib/server/queries";
import { TRENDING_FORMULA } from "@/lib/agents/stats";

export const metadata: Metadata = { title: "Explore Agents" };
export const dynamic = "force-dynamic";

const params = z.object({
  q: z.string().max(80).optional().catch(undefined),
  specialization: z
    .enum(["GOLD", "TREASURIES", "REAL_ESTATE", "PRIVATE_CREDIT", "COMMODITIES", "MULTI_ASSET"])
    .optional()
    .catch(undefined),
  sort: z.enum(["recent", "trending", "active", "name"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
  token: z.enum(["1"]).optional().catch(undefined),
});

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = params.parse(await searchParams);
  const filtered = Boolean(sp.q || sp.specialization || sp.token);
  let result: Awaited<ReturnType<typeof listMarketplace>> | null = null;
  try {
    result = await listMarketplace({ ...sp, tokenOnly: sp.token === "1", pageSize: 12 });
  } catch (e) {
    console.error("[explore]", e);
  }

  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    Object.entries({ ...sp, page: p }).forEach(([k, v]) => v !== undefined && v !== "" && u.set(k, String(v)));
    return `/explore?${u}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="mb-8 space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Explore agents</h1>
        <p className="text-muted">
          Every agent listed here was created and activated by a real creator.{" "}
          {sp.sort === "trending" && <span className="text-subtle">Trending = {TRENDING_FORMULA}.</span>}
        </p>
      </div>

      <ExploreFilters initial={{ q: sp.q ?? "", specialization: sp.specialization ?? "", sort: sp.sort ?? "recent", token: sp.token === "1" }} />

      <div className="mt-8">
        {!result ? (
          <EmptyState title="Marketplace unavailable" description="The database could not be reached. Please try again shortly." />
        ) : result.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<SearchX />}
              title="No agents match these filters"
              description="Try a different search term or category."
              action={
                <Button asChild variant="secondary">
                  <Link href="/explore">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Bot />}
              title="No agents yet"
              description="Agents appear here after their creators activate them."
              action={
                <Button asChild variant="primary">
                  <Link href="/create">Launch the first agent</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <p className="mb-4 text-sm text-subtle" aria-live="polite">
              {result.total} agent{result.total === 1 ? "" : "s"}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.items.map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </div>
            {result.pages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
                <Button asChild variant="secondary" size="sm" className={result.page <= 1 ? "pointer-events-none opacity-40" : ""}>
                  <Link href={pageHref(result.page - 1)} aria-disabled={result.page <= 1}>
                    Previous
                  </Link>
                </Button>
                <span className="px-3 text-sm text-muted">
                  Page {result.page} of {result.pages}
                </span>
                <Button asChild variant="secondary" size="sm" className={result.page >= result.pages ? "pointer-events-none opacity-40" : ""}>
                  <Link href={pageHref(result.page + 1)} aria-disabled={result.page >= result.pages}>
                    Next
                  </Link>
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
