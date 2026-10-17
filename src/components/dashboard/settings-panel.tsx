"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { AUTONOMY_MODES, MONITOR_INTERVALS, REPORTING_STYLES, RISK_SENSITIVITIES, SCHEDULE_INTERVALS, DEFAULT_MONITORING } from "@/lib/agents/constants";
import { PROVIDERS } from "@/lib/providers/registry";
import { cn } from "@/lib/utils";

export interface AgentRecord {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  description: string;
  imageId: string | null;
  specialization: string;
  objectives: string[];
  status: string;
  adminDisabled: boolean;
  disabledReason: string | null;
  lastSuccessAt: string | null;
  config: {
    researchObjectives: string[];
    dataSources: string[];
    customSourceUrls: string[];
    focusAssets: string[];
    riskSensitivity: string;
    reportingStyle: string;
    monitoringCriteria: typeof DEFAULT_MONITORING;
    maxToolCalls: number;
    dailyRunLimit: number;
    dailyTokenBudget: number;
    dailySpendLimitUsd: number;
    version: number;
  } | null;
  schedule: { mode: string; intervalMinutes: number; monitorMinutes: number; nextRunAt: string | null; nextMonitorAt: string | null } | null;
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function SettingsPanel({ agent, onSaved }: { agent: AgentRecord; onSaved: () => void }) {
  const c = agent.config!;
  const [description, setDescription] = useState(agent.description);
  const [objectives, setObjectives] = useState(agent.objectives.join("\n"));
  const [research, setResearch] = useState(c.researchObjectives.join("\n"));
  const [sources, setSources] = useState<string[]>(c.dataSources);
  const [urls, setUrls] = useState(c.customSourceUrls.join("\n"));
  const [focus, setFocus] = useState(c.focusAssets.join(", "));
  const [risk, setRisk] = useState(c.riskSensitivity);
  const [style, setStyle] = useState(c.reportingStyle);
  const [monitoring, setMonitoring] = useState({ ...DEFAULT_MONITORING, ...c.monitoringCriteria });
  const [mode, setMode] = useState(agent.schedule?.mode ?? "MANUAL");
  const [interval, setIntervalMinutes] = useState(agent.schedule?.intervalMinutes ?? 360);
  const [monitorEvery, setMonitorEvery] = useState(agent.schedule?.monitorMinutes ?? 30);
  const [spendLimit, setSpendLimit] = useState(String(c.dailySpendLimitUsd ?? 0.25));
  const [runLimit, setRunLimit] = useState(String(c.dailyRunLimit));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const locked = agent.adminDisabled || agent.status === "DISABLED";

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      await api(`/api/agents/${agent.id}`, {
        method: "PATCH",
        body: {
          description,
          objectives: lines(objectives),
          intelligence: {
            researchObjectives: lines(research),
            dataSources: sources,
            customSourceUrls: lines(urls),
            focusAssets: focus.split(",").map((x) => x.trim()).filter(Boolean),
            riskSensitivity: risk,
            reportingStyle: style,
            monitoringCriteria: monitoring,
          },
          autonomy: { mode, intervalMinutes: interval, monitorMinutes: monitorEvery },
          limits: { dailySpendLimitUsd: Number(spendLimit), dailyRunLimit: Number(runLimit) },
        },
      });
      toast.success("Settings saved", { description: "Changes apply from the next run and are recorded in the agent's memory." });
      onSaved();
    } catch (e) {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const err = (k: string) => Object.entries(errors).find(([p]) => p.startsWith(k))?.[1];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <p className="text-[13px] text-muted">Name, ticker and specialization are permanent.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Description" htmlFor="s-desc" error={err("description")}>
            <Textarea id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} disabled={locked} />
          </Field>
          <Field label="Objectives (one per line)" htmlFor="s-obj" error={err("objectives")}>
            <Textarea id="s-obj" value={objectives} onChange={(e) => setObjectives(e.target.value)} disabled={locked} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intelligence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Research objectives (one per line)" htmlFor="s-res" error={err("intelligence.researchObjectives")}>
            <Textarea id="s-res" value={research} onChange={(e) => setResearch(e.target.value)} disabled={locked} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-silver">Data sources</legend>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((p) => {
                const on = sources.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={locked || p.id === "defillama-rwa"}
                    aria-pressed={on}
                    onClick={() => setSources(on ? sources.filter((s) => s !== p.id) : [...sources, p.id])}
                    className={cn("rounded-full border px-3 py-1.5 text-[13px] cursor-pointer disabled:cursor-not-allowed", on ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted")}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
            {err("intelligence.dataSources") && <p className="mt-1 text-[12px] text-danger">{err("intelligence.dataSources")}</p>}
          </fieldset>
          {sources.includes("web") && (
            <Field label="Web pages (https, one per line, max 5)" htmlFor="s-urls" error={err("intelligence.customSourceUrls")}>
              <Textarea id="s-urls" value={urls} onChange={(e) => setUrls(e.target.value)} disabled={locked} />
            </Field>
          )}
          <Field label="Focus assets (comma separated)" htmlFor="s-focus" error={err("intelligence.focusAssets")}>
            <Input id="s-focus" value={focus} onChange={(e) => setFocus(e.target.value)} disabled={locked} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Risk sensitivity" htmlFor="s-risk">
              <Select id="s-risk" value={risk} onChange={(e) => setRisk(e.target.value)} disabled={locked}>
                {RISK_SENSITIVITIES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Reporting style" htmlFor="s-style">
              <Select id="s-style" value={style} onChange={(e) => setStyle(e.target.value)} disabled={locked}>
                {REPORTING_STYLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            {(
              [
                ["priceChangePct", "Price move (%)"],
                ["yieldChangeBps", "Yield move (bps)"],
                ["tvlChangePct", "Value change (%)"],
                ["staleDataHours", "Stale after (h)"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`s-${k}`} error={err(`intelligence.monitoringCriteria.${k}`)}>
                <Input id={`s-${k}`} type="number" value={monitoring[k]} onChange={(e) => setMonitoring({ ...monitoring, [k]: Number(e.target.value) })} disabled={locked} />
              </Field>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Research schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <Field label="Autonomy mode" htmlFor="s-mode">
            <Select id="s-mode" value={mode} onChange={(e) => setMode(e.target.value)} disabled={locked}>
              {AUTONOMY_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Research frequency" htmlFor="s-int">
            <Select id="s-int" value={interval} onChange={(e) => setIntervalMinutes(Number(e.target.value))} disabled={locked || !(mode === "SCHEDULED" || mode === "CONTINUOUS")}>
              {SCHEDULE_INTERVALS.map((s) => (
                <option key={s.minutes} value={s.minutes}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Monitoring frequency" htmlFor="s-mon">
            <Select id="s-mon" value={monitorEvery} onChange={(e) => setMonitorEvery(Number(e.target.value))} disabled={locked || !(mode === "EVENT_TRIGGERED" || mode === "CONTINUOUS")}>
              {MONITOR_INTERVALS.map((s) => (
                <option key={s.minutes} value={s.minutes}>{s.label}</option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI spending limits</CardTitle>
          <p className="text-[13px] text-muted">
            Shared by research runs and public chat, per UTC day. When a limit is reached the agent publishes a clearly labelled
            fallback report from the mechanical engine instead of calling the AI model.
          </p>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field label="Daily AI spend limit (USD, est.)" htmlFor="s-spend" error={err("limits.dailySpendLimitUsd")} hint="0 disables AI for this agent. Max $5.00.">
            <Input id="s-spend" type="number" step="0.05" min="0" max="5" value={spendLimit} onChange={(e) => setSpendLimit(e.target.value)} disabled={locked} />
          </Field>
          <Field label="Research runs per day" htmlFor="s-runs" error={err("limits.dailyRunLimit")} hint="1–24 runs per UTC day.">
            <Input id="s-runs" type="number" min="1" max="24" value={runLimit} onChange={(e) => setRunLimit(e.target.value)} disabled={locked} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={save} loading={saving} disabled={locked}>
          <Save /> Save changes
        </Button>
      </div>
    </div>
  );
}
