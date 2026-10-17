import { AlertTriangle, Bot, ExternalLink, Info, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { RiskBadge } from "./agent-bits";
import type { ReportBody } from "@/lib/agents/schemas";
import type { Fact, NormalizedAsset } from "@/lib/providers/types";
import type { Factor } from "@/lib/agents/scoring";
import { providerName } from "@/lib/providers/registry";
import { formatDateTime, formatPct, formatUsd } from "@/lib/utils";

export interface ReportViewData {
  id: string;
  title: string;
  summary: string;
  body: unknown;
  riskScore: number;
  riskLevel: string;
  confidence: number;
  methodology: string;
  narrativeBy: string;
  createdAt: Date | string;
  sources: { id: string; providerId: string; title: string; url: string; retrievedAt: Date | string; dataTimestamp: Date | string | null; stale: boolean }[];
  assets: { id: string; name: string; category: string; riskScore: number; riskLevel: string; facts: unknown; factors: unknown }[];
}

const FACT_LABELS: Record<string, [string, (f: Fact) => string]> = {
  marketPriceUsd: ["Market price", (f) => formatUsd(f.value)],
  priceChange24hPct: ["24h change", (f) => formatPct(f.value)],
  referenceValueUsd: ["Reported value", (f) => formatUsd(f.value)],
  publishedYieldPct: ["Published yield", (f) => formatPct(f.value)],
  yield7dChangePct: ["Yield 7d change", (f) => `${f.value.toFixed(2)} pp`],
  yieldMean30dPct: ["Yield 30d mean", (f) => formatPct(f.value)],
  liquidityTvlUsd: ["Pool TVL", (f) => formatUsd(f.value)],
  volume24hUsd: ["24h volume", (f) => formatUsd(f.value)],
};

function SourceChips({ ids, index }: { ids: string[]; index: ReportBody["sourceIndex"] }) {
  if (!ids.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) =>
        index[id] ? (
          <a key={id} href={index[id].url} target="_blank" rel="noopener noreferrer nofollow" title={index[id].title} className="rounded bg-surface-2 px-1.5 py-px font-mono text-[11px] text-accent hover:bg-accent/10">
            {id}
          </a>
        ) : null,
      )}
    </span>
  );
}

export function ReportView({ report, compact = false }: { report: ReportViewData; compact?: boolean }) {
  const body = report.body as ReportBody;
  const ai = report.narrativeBy !== "deterministic";
  return (
    <article id={report.id} className="scroll-mt-24 rounded-[16px] border border-border surface-sheen">
      <header className="space-y-3 border-b border-border p-6">
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={report.riskLevel} score={report.riskScore} />
          <Badge>Confidence {report.confidence}%</Badge>
          {ai ? (
            <Badge tone="accent">
              <Bot className="size-3.5" /> AI research · {report.narrativeBy.replace("llm:", "")}
            </Badge>
          ) : (
            <Badge tone={body.mode === "fallback" ? "warning" : "silver"}>{body.mode === "fallback" ? "Fallback report · mechanical engine" : "Deterministic writer"}</Badge>
          )}
          <span className="text-[12px] text-subtle">Generated {formatDateTime(report.createdAt)}</span>
        </div>
        <h2 className="font-display text-xl font-semibold">{report.title}</h2>
        <p className="text-[15px] leading-relaxed text-silver">{report.summary}</p>
      </header>

      <div className="space-y-8 p-6">
        {!ai && body.fallbackReason && (
          <div className="rounded-[12px] border border-warning/25 bg-warning/[0.04] p-4 text-sm text-muted">
            <p className="font-medium text-warning">Fallback report</p>
            <p className="mt-1">
              This report was written by RoviumPad&apos;s mechanical engine, not the AI agent. Reason: {body.fallbackReason} All figures come
              directly from the data providers.
            </p>
          </div>
        )}

        {ai && (body.plan || body.reasoning) && (
          <section className="space-y-3 rounded-[12px] border border-accent/20 bg-accent/[0.03] p-4">
            <h3 className="flex items-center gap-2 font-display font-semibold">
              <Bot className="size-4 text-accent" /> How the agent researched this
            </h3>
            {body.plan && (
              <div className="text-sm text-muted">
                <p>
                  <span className="text-silver">Goal:</span> {body.plan.goal}
                </p>
                {body.plan.hypotheses.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                    {body.plan.hypotheses.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {body.reasoning && <p className="text-sm leading-relaxed text-silver">{body.reasoning}</p>}
            {!compact && body.toolSummary && body.toolSummary.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-subtle">
                <Wrench className="size-3.5" /> Tools used:
                {Object.entries(
                  body.toolSummary.reduce<Record<string, number>>((acc, t) => ((acc[t.name] = (acc[t.name] ?? 0) + 1), acc), {}),
                ).map(([name, n]) => (
                  <span key={name} className="rounded bg-surface-2 px-1.5 py-px font-mono text-[11px] text-silver">
                    {name}×{n}
                  </span>
                ))}
              </p>
            )}
          </section>
        )}

        {body.warnings?.length > 0 && (
          <div className="rounded-[12px] border border-warning/25 bg-warning/[0.04] p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="size-4" /> Data warnings
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {body.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <section>
          <h3 className="mb-3 font-display font-semibold">Key findings</h3>
          <ul className="space-y-2">
            {body.keyFindings.map((f, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-silver">
                <span className={`mt-2 size-1.5 shrink-0 rounded-full ${f.importance === "high" ? "bg-warning" : "bg-accent"}`} />
                <span>
                  {(f.importance || f.novelty) && (
                    <span className="mr-2 inline-flex gap-1 align-middle">
                      {f.importance && <Badge tone={f.importance === "high" ? "warning" : "neutral"}>{f.importance}</Badge>}
                      {f.novelty && <Badge tone={f.novelty === "new" ? "accent" : f.novelty === "changed" ? "warning" : "neutral"}>{f.novelty}</Badge>}
                    </span>
                  )}
                  {f.text}
                  <SourceChips ids={f.sourceIds} index={body.sourceIndex} />
                  {f.reasoning && !compact && <span className="mt-1 block text-[13px] text-muted">Why: {f.reasoning}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {body.riskAssessment && (
          <section>
            <h3 className="mb-2 font-display font-semibold">Risk assessment</h3>
            <p className="text-sm leading-relaxed text-muted">
              {body.riskAssessment.text}
              <SourceChips ids={body.riskAssessment.sourceIds} index={body.sourceIndex} />
            </p>
          </section>
        )}

        {body.changes?.length > 0 && (
          <section>
            <h3 className="mb-3 font-display font-semibold">What changed since the previous run</h3>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-[12px] text-subtle">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Asset</th>
                    <th className="py-2 pr-4 font-medium">Metric</th>
                    <th className="py-2 pr-4 font-medium">Change</th>
                    <th className="py-2 font-medium">Threshold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {body.changes.map((c, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-4 text-silver">{c.name}</td>
                      <td className="py-2 pr-4 text-muted">{c.metric}</td>
                      <td className="py-2 pr-4 font-mono tabular-nums text-silver">
                        {c.change >= 0 ? "+" : ""}
                        {c.unit === "bps" ? `${c.change.toFixed(0)} bps` : `${c.change.toFixed(2)}%`}
                      </td>
                      <td className="py-2">{c.breached ? <Badge tone="warning">Crossed</Badge> : <span className="text-[12px] text-subtle">within</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-1 font-display font-semibold">Verified facts by asset</h3>
          <p className="mb-4 flex items-center gap-1.5 text-[12px] text-subtle">
            <Info className="size-3.5" /> Values below come directly from data providers. Missing metrics are shown as unavailable, never estimated.
          </p>
          <div className="space-y-4">
            {report.assets.map((a) => {
              const asset = a.facts as NormalizedAsset;
              const factors = a.factors as Factor[];
              return (
                <details key={a.id} className="group rounded-[12px] border border-border bg-bg-2" open={!compact && report.assets.length <= 3}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      {asset.symbol && <span className="font-mono text-[12px] text-muted">{asset.symbol}</span>}
                      <Badge>{a.category.replace("_", " ").toLowerCase()}</Badge>
                    </span>
                    <RiskBadge level={a.riskLevel} score={a.riskScore} />
                  </summary>
                  <div className="space-y-5 border-t border-border p-4">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                      {Object.entries(FACT_LABELS).map(([k, [label, fmt]]) => {
                        const f = asset.facts?.[k as keyof NormalizedAsset["facts"]];
                        return (
                          <div key={k}>
                            <dt className="text-[11px] text-subtle">{label}</dt>
                            <dd className="mt-0.5 font-mono text-sm tabular-nums text-silver">
                              {f ? (
                                <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-accent" title={`${providerName(f.providerId)} · as of ${formatDateTime(f.asOf)}`}>
                                  {fmt(f)}
                                  {f.stale && <span className="ml-1 text-warning">(stale)</span>}
                                </a>
                              ) : (
                                <span className="text-subtle">unavailable</span>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                    <div className="grid gap-2 text-[13px] text-muted sm:grid-cols-2">
                      <p>
                        <span className="text-subtle">Networks:</span> {asset.networks?.length ? asset.networks.join(", ") : "not reported"}
                      </p>
                      <p>
                        <span className="text-subtle">Audits listed:</span> {asset.auditCount ?? "not reported"}
                      </p>
                      {asset.tokenContracts?.[0] && (
                        <p className="break-all">
                          <span className="text-subtle">Contract:</span> {asset.tokenContracts[0].network} {asset.tokenContracts[0].address}
                        </p>
                      )}
                      {asset.website && (
                        <p>
                          <span className="text-subtle">Issuer site:</span>{" "}
                          <a href={asset.website} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
                            {asset.website.replace(/^https?:\/\//, "")}
                          </a>
                        </p>
                      )}
                      <p className="sm:col-span-2">
                        <span className="text-subtle">Not available from configured sources:</span> redemption restrictions, custodian, regulatory status.
                      </p>
                    </div>
                    <div>
                      <p className="mb-2 text-[12px] text-subtle">Risk factor breakdown ({report.methodology})</p>
                      <ul className="space-y-2">
                        {factors.map((f) => (
                          <li key={f.id} className="grid grid-cols-[140px_1fr] items-start gap-3 text-[13px] sm:grid-cols-[180px_60px_1fr]">
                            <span className="text-silver">{f.label}</span>
                            <span className="font-mono tabular-nums text-muted">{f.score == null ? "n/a" : f.score}</span>
                            <span className="col-span-2 text-muted sm:col-span-1">{f.rationale}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        {!compact && (
          <section className="space-y-5">
            <div>
              <h3 className="font-display font-semibold">Analysis</h3>
              <p className="mt-1 text-[12px] text-subtle">
                {ai
                  ? "Interpretation written by the AI model from the verified facts above. Treat it as analysis, not fact."
                  : "Derived mechanically from the verified facts above; contains no model-generated interpretation."}
              </p>
            </div>
            {body.sections.map((s) => (
              <div key={s.key}>
                <h4 className="text-sm font-medium text-fg">{s.title}</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {s.text}
                  <SourceChips ids={s.sourceIds} index={body.sourceIndex} />
                </p>
              </div>
            ))}
            {body.uncertainties?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-fg">Confidence & uncertainty</h4>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                  {body.uncertainties.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {body.macro?.length > 0 && (
          <section>
            <h3 className="mb-2 font-display font-semibold">Reference rates</h3>
            <ul className="space-y-1 text-sm text-muted">
              {body.macro.map((m) => (
                <li key={m.key}>
                  <a href={m.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-accent">
                    {m.label}: <span className="font-mono text-silver">{m.value.toFixed(3)}%</span>
                  </a>
                  {m.stale && <span className="ml-1 text-warning">(stale)</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {ai && !compact && (
          <section className="rounded-[12px] border border-border bg-bg-2 p-4 text-[13px] text-muted">
            <p className="flex items-center gap-2 font-medium text-silver">
              <ShieldCheck className="size-4 text-success" /> Grounding checks
            </p>
            {body.groundingIssues && body.groundingIssues.length > 0 ? (
              <>
                <p className="mt-1">
                  {body.groundingIssues.length} correction{body.groundingIssues.length > 1 ? "s were" : " was"} applied automatically before publication:
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {body.groundingIssues.slice(0, 8).map((g, i) => (
                    <li key={i}>{g.detail}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1">All citations matched real sources and every figure matched a verified value.</p>
            )}
            {body.usage && body.usage.modelCalls > 0 && (
              <p className="mt-2 text-[12px] text-subtle">
                {body.usage.modelCalls} model calls · {(body.usage.promptTokens + body.usage.completionTokens).toLocaleString()} tokens · est. $
                {body.usage.costUsd.toFixed(4)}
              </p>
            )}
          </section>
        )}

        <section>
          <h3 className="mb-3 font-display font-semibold">Sources</h3>
          <ol className="space-y-2 text-[13px]">
            {Object.entries(body.sourceIndex).map(([id, s]) => {
              const src = report.sources.find((x) => x.url === s.url);
              return (
                <li key={id} className="flex gap-2">
                  <span className="w-7 shrink-0 font-mono text-subtle">{id}</span>
                  <span className="min-w-0">
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-silver hover:text-accent">
                      {s.title} <ExternalLink className="inline size-3" />
                    </a>
                    {src && (
                      <span className="block text-subtle">
                        {providerName(src.providerId)} · retrieved {formatDateTime(src.retrievedAt)}
                        {src.dataTimestamp && ` · data as of ${formatDateTime(src.dataTimestamp)}`}
                        {src.stale && <span className="text-warning"> · stale</span>}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </article>
  );
}
