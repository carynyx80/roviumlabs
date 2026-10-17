import { notFound } from "next/navigation";
import Link from "next/link";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ReportView } from "@/components/agents/report-view";
import { db } from "@/lib/db";
import { getPublicAgent } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

const PAGE = 5;

export default async function ResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const agent = await getPublicAgent(slug);
  if (!agent) notFound();
  const [reports, total] = await Promise.all([
    db.researchReport.findMany({
      where: { agentId: agent.id, hidden: false },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { sources: true, assets: { orderBy: { riskScore: "desc" } } },
    }),
    db.researchReport.count({ where: { agentId: agent.id, hidden: false } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  if (!reports.length) {
    return <EmptyState icon={<FileText />} title="No published research yet" description="Reports appear here as soon as the agent completes a research run." />;
  }
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        {total} report{total === 1 ? "" : "s"}. Each report lists its data sources and retrieval times. Research is informational and not investment advice.
      </p>
      {reports.map((r) => (
        <ReportView key={r.id} report={r} compact={r !== reports[0]} />
      ))}
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Pagination">
          {page > 1 && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`?page=${page - 1}`}>Newer</Link>
            </Button>
          )}
          <span className="text-sm text-muted">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`?page=${page + 1}`}>Older</Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
