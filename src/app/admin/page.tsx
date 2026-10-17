import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { llmConfigured } from "@/lib/env";
import { queueDriver } from "@/lib/queue";
import { PROVIDERS } from "@/lib/providers/registry";
import { Badge, Card, CardContent, CardHeader, CardTitle, Stat } from "@/components/ui/primitives";
import { SignInGate } from "@/components/wallet/sign-in-gate";
import { AdminAction } from "@/components/admin/admin-action";
import { formatDateTime, shortAddress, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <SignInGate title="Administrator sign-in" />
      </div>
    );
  }
  // Non-admins get a 404 so the console's existence is not confirmed.
  if (session.user.role !== "ADMIN") notFound();

  const dayAgo = new Date(Date.now() - 86400_000);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [workers, health, failed, abuse, agents, audits, jobCounts, execs24h, tokens, users] = await Promise.all([
    db.workerHeartbeat.findMany({ orderBy: { lastBeatAt: "desc" } }),
    db.providerHealth.findMany(),
    db.agentExecution.findMany({ where: { status: "FAILED" }, orderBy: { finishedAt: "desc" }, take: 15, include: { agent: { select: { name: true, id: true } } } }),
    db.agentAbuseReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 30, include: { agent: { select: { name: true, slug: true, id: true } }, reporter: { select: { wallets: { take: 1 } } } } }),
    db.agent.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { owner: { select: { id: true, banned: true, wallets: { take: 1 } } }, _count: { select: { abuseReports: true } } } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.job.groupBy({ by: ["status"], _count: true }),
    db.agentExecution.groupBy({ by: ["status"], where: { queuedAt: { gte: dayAgo } }, _count: true }),
    db.usageRecord.aggregate({ where: { createdAt: { gte: startOfDay } }, _sum: { promptTokens: true, completionTokens: true } }),
    db.user.count(),
  ]);
  const onlineWorkers = workers.filter((w) => w.lastBeatAt > new Date(Date.now() - 60_000));
  const count = (rows: { status: string; _count: number }[], s: string) => rows.find((r) => r.status === s)?._count ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Admin console</h1>
        <p className="mt-1 text-muted">System health, moderation and audit trail. All actions are logged.</p>
      </div>

      <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-6">
        <Stat label="Workers online" value={onlineWorkers.length} hint={`queue: ${queueDriver()}`} />
        <Stat label="Pending jobs" value={count(jobCounts, "PENDING")} />
        <Stat label="Runs 24h" value={execs24h.reduce((s, r) => s + r._count, 0)} hint={`${count(execs24h, "FAILED")} failed`} />
        <Stat label="LLM tokens today" value={((tokens._sum.promptTokens ?? 0) + (tokens._sum.completionTokens ?? 0)).toLocaleString()} hint={llmConfigured() ? "provider configured" : "no provider"} />
        <Stat label="Users" value={users} />
        <Stat label="Open reports" value={abuse.length} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data providers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60 text-sm">
              {PROVIDERS.filter((p) => p.id !== "web").map((p) => {
                const h = health.find((x) => x.providerId === p.id);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>{p.name}</span>
                    <span className="flex items-center gap-2 text-[12px] text-subtle">
                      {h ? (
                        <>
                          {h.latencyMs != null && `${h.latencyMs} ms · `}
                          {h.ok ? `ok ${timeAgo(h.lastOkAt)}` : `failing (${h.failureCount}) ${h.lastError?.slice(0, 40) ?? ""}`}
                          <Badge tone={h.ok ? "success" : "danger"}>{h.ok ? "Healthy" : "Down"}</Badge>
                        </>
                      ) : (
                        <Badge>Not used yet</Badge>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workers</CardTitle>
          </CardHeader>
          <CardContent>
            {workers.length ? (
              <ul className="space-y-2 text-sm">
                {workers.map((w) => (
                  <li key={w.id} className="flex justify-between gap-3">
                    <span className="truncate font-mono text-[12px]">{w.id}</span>
                    <span className="text-[12px] text-subtle">
                      beat {timeAgo(w.lastBeatAt)} · {w.jobsDone} done / {w.jobsFailed} failed
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-danger">No worker has ever connected. Autonomous research is not running.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Failed executions</CardTitle>
        </CardHeader>
        <CardContent>
          {failed.length ? (
            <ul className="divide-y divide-border/60 text-sm">
              {failed.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex justify-between gap-3">
                    <Link href={`/dashboard/agents/${e.agent.id}?tab=executions`} className="text-silver hover:underline">
                      {e.agent.name}
                    </Link>
                    <span className="text-[12px] text-subtle">{e.finishedAt && formatDateTime(e.finishedAt)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-danger">{e.error}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No failed executions.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open abuse reports</CardTitle>
        </CardHeader>
        <CardContent>
          {abuse.length ? (
            <ul className="divide-y divide-border/60 text-sm">
              {abuse.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Link href={`/agents/${r.agent.slug}`} className="font-medium hover:underline">
                      {r.agent.name}
                    </Link>
                    <p className="text-[13px] text-muted">{r.reason}</p>
                    <p className="text-[12px] text-subtle">
                      by {shortAddress(r.reporter.wallets[0]?.address)} · {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <AdminAction body={{ target: "abuse-report", id: r.id, action: "resolve" }} label="Resolve" />
                    <AdminAction body={{ target: "abuse-report", id: r.id, action: "dismiss" }} label="Dismiss" variant="ghost" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No open reports.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[12px] text-subtle">
              <tr>
                <th className="py-2 font-medium">Agent</th>
                <th className="py-2 font-medium">Owner</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Reports</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {agents.map((a) => (
                <tr key={a.id}>
                  <td className="py-2.5">{a.name}</td>
                  <td className="py-2.5 font-mono text-[12px] text-muted">
                    {shortAddress(a.owner.wallets[0]?.address)} {a.owner.banned && <Badge tone="danger">banned</Badge>}
                  </td>
                  <td className="py-2.5">
                    {a.adminDisabled ? <Badge tone="danger">suspended</Badge> : <Badge>{a.status.toLowerCase()}</Badge>} {a.featured && <Badge tone="accent">featured</Badge>}
                  </td>
                  <td className="py-2.5 text-muted">{a._count.abuseReports}</td>
                  <td className="py-2.5">
                    <div className="flex justify-end gap-2">
                      {a.adminDisabled ? (
                        <AdminAction body={{ target: "agent", id: a.id, action: "enable" }} label="Reinstate" />
                      ) : (
                        <AdminAction body={{ target: "agent", id: a.id, action: "disable" }} label="Suspend" variant="danger" askReason />
                      )}
                      {!a.adminDisabled && (a.status === "ACTIVE" || a.status === "PAUSED") && (
                        <AdminAction body={{ target: "agent", id: a.id, action: a.featured ? "unfeature" : "feature" }} label={a.featured ? "Unfeature" : "Feature"} variant="ghost" />
                      )}
                      <AdminAction body={{ target: "user", id: a.owner.id, action: a.owner.banned ? "unban" : "ban" }} label={a.owner.banned ? "Unban owner" : "Ban owner"} variant="ghost" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 font-mono text-[12px] text-muted">
            {audits.map((l) => (
              <li key={l.id}>
                {formatDateTime(l.createdAt)} · {l.action} · {l.target ?? "—"} {l.ip && `· ${l.ip}`}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
