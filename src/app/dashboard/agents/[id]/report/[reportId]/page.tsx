import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ReportView } from "@/components/agents/report-view";

export const dynamic = "force-dynamic";

/** Creator view of a report (works for paused/disabled agents and hidden reports too). */
export default async function OwnerReportPage({ params }: { params: Promise<{ id: string; reportId: string }> }) {
  const { id, reportId } = await params;
  const session = await getSession();
  if (!session) return null; // the dashboard layout renders the sign-in gate
  const report = await db.researchReport.findUnique({
    where: { id: reportId },
    include: { sources: true, assets: { orderBy: { riskScore: "desc" } }, agent: { select: { id: true, ownerId: true, name: true } } },
  });
  if (!report || report.agent.id !== id || (report.agent.ownerId !== session.userId && session.user.role !== "ADMIN")) notFound();
  return (
    <div className="space-y-4">
      <Link href={`/dashboard/agents/${id}?tab=executions`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> {report.agent.name} executions
      </Link>
      {report.hidden && <p className="text-sm text-warning">This report was hidden by a moderator and is not public.</p>}
      <ReportView report={report} />
    </div>
  );
}
