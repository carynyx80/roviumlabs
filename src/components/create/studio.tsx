"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, ImagePlus, Loader2, Plus, Rocket, Trash2, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/overlays";
import { AgentAvatar } from "@/components/agents/agent-bits";
import { useSession } from "@/components/providers";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import {
  AUTONOMY_MODES,
  DEFAULT_MONITORING,
  MONITOR_INTERVALS,
  REPORTING_STYLES,
  RISK_SENSITIVITIES,
  SCHEDULE_INTERVALS,
  SPECIALIZATIONS,
  TOKEN_UTILITY_DISCLOSURE,
} from "@/lib/agents/constants";
import { autonomySchema, identitySchema, intelligenceSchema, tickerSchema } from "@/lib/agents/validation";
import { DEFAULT_PROVIDERS, PROVIDERS } from "@/lib/providers/registry";
import { cn } from "@/lib/utils";

interface FormState {
  identity: {
    name: string;
    ticker: string;
    description: string;
    imageId: string | null;
    specialization: string;
    objectives: string[];
  };
  intelligence: {
    researchObjectives: string[];
    dataSources: string[];
    customSourceUrls: string[];
    focusAssets: string[];
    riskSensitivity: string;
    reportingStyle: string;
    monitoringCriteria: typeof DEFAULT_MONITORING;
  };
  autonomy: { mode: string; intervalMinutes: number; monitorMinutes: number };
  token: { planned: boolean; tokenName: string; tokenSymbol: string; totalSupply: string };
}

const INITIAL: FormState = {
  identity: { name: "", ticker: "", description: "", imageId: null, specialization: "TREASURIES", objectives: [""] },
  intelligence: {
    researchObjectives: [""],
    dataSources: [...DEFAULT_PROVIDERS],
    customSourceUrls: [],
    focusAssets: [],
    riskSensitivity: "BALANCED",
    reportingStyle: "DETAILED",
    monitoringCriteria: { ...DEFAULT_MONITORING },
  },
  autonomy: { mode: "SCHEDULED", intervalMinutes: 360, monitorMinutes: 30 },
  token: { planned: false, tokenName: "", tokenSymbol: "", totalSupply: "1000000000" },
};

const STEPS = ["Identity", "Intelligence", "Autonomy", "Token (optional)", "Review & deploy"];

type Errors = Record<string, string>;

function zodErrors(prefix: string, err: { issues: { path: (string | number)[]; message: string }[] }): Errors {
  return Object.fromEntries(err.issues.map((i) => [`${prefix}.${i.path.join(".")}`, i.message]));
}

const clean = (arr: string[]) => arr.map((s) => s.trim()).filter(Boolean);

function ListEditor({
  label,
  hint,
  values,
  onChange,
  placeholder,
  max,
  errorPrefix,
  errors,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max: number;
  errorPrefix: string;
  errors: Errors;
}) {
  const listError = errors[errorPrefix];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[13px] font-medium text-silver">{label}</legend>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={v}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={placeholder}
            aria-label={`${label} ${i + 1}`}
            aria-invalid={Boolean(errors[`${errorPrefix}.${i}`])}
            maxLength={240}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            disabled={values.length === 1 && max > 0 && errorPrefix.endsWith("bjectives")}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      {values.length < max && (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onChange([...values, ""])}>
          <Plus /> Add
        </Button>
      )}
      {listError ? <p className="text-[12px] text-danger">{listError}</p> : hint ? <p className="text-[12px] text-subtle">{hint}</p> : null}
      {Object.entries(errors)
        .filter(([k]) => k.startsWith(`${errorPrefix}.`))
        .slice(0, 1)
        .map(([k, m]) => (
          <p key={k} className="text-[12px] text-danger">
            {m}
          </p>
        ))}
    </fieldset>
  );
}

export function CreateStudio({ llmConfigured, chains }: { llmConfigured: boolean; chains: { id: number; name: string }[] }) {
  const { user, status, openConnect } = useSession();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [draftId, setDraftId] = useState<string | undefined>();
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activate, setActivate] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);

  // Restore draft once signed in.
  useEffect(() => {
    if (!user || loadedDraft) return;
    api<{ draft: { id: string; data: FormState; step: number } | null }>("/api/drafts")
      .then(({ draft }) => {
        if (draft?.data?.identity) {
          setForm({ ...INITIAL, ...draft.data, token: { ...INITIAL.token, ...(draft.data.token ?? {}) } });
          setStep(Math.min(draft.step, STEPS.length - 1));
          setDraftId(draft.id);
          toast.message("Draft restored", { description: "Your unfinished agent was restored." });
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadedDraft(true));
  }, [user, loadedDraft]);

  // Debounced autosave.
  useEffect(() => {
    if (!user || !loadedDraft || !dirty.current) return;
    const t = setTimeout(async () => {
      setDraftState("saving");
      try {
        const r = await api<{ draft: { id: string } }>("/api/drafts", { method: "PUT", body: { id: draftId, step, data: form } });
        setDraftId(r.draft.id);
        setDraftState("saved");
      } catch {
        setDraftState("error");
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [form, step, user, loadedDraft, draftId]);

  const update = <K extends keyof FormState>(key: K, patch: Partial<FormState[K]>) => {
    dirty.current = true;
    setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  };

  const spec = SPECIALIZATIONS.find((s) => s.id === form.identity.specialization)!;

  const payload = useMemo(
    () => ({
      identity: { ...form.identity, objectives: clean(form.identity.objectives) },
      intelligence: {
        ...form.intelligence,
        researchObjectives: clean(form.intelligence.researchObjectives),
        customSourceUrls: clean(form.intelligence.customSourceUrls),
        focusAssets: clean(form.intelligence.focusAssets),
      },
      autonomy: form.autonomy,
    }),
    [form],
  );

  const validateStep = (s: number): boolean => {
    let errs: Errors = {};
    if (s === 0) {
      const r = identitySchema.safeParse(payload.identity);
      if (!r.success) errs = zodErrors("identity", r.error);
    } else if (s === 1) {
      const r = intelligenceSchema.safeParse(payload.intelligence);
      if (!r.success) errs = zodErrors("intelligence", r.error);
      if (payload.intelligence.dataSources.includes("web") && !payload.intelligence.customSourceUrls.length) {
        errs["intelligence.customSourceUrls"] = "Add at least one https URL or deselect web pages";
      }
    } else if (s === 2) {
      const r = autonomySchema.safeParse(payload.autonomy);
      if (!r.success) errs = zodErrors("autonomy", r.error);
    } else if (s === 3 && form.token.planned) {
      if (form.token.tokenName.trim().length < 3) errs["token.tokenName"] = "At least 3 characters";
      if (!tickerSchema.safeParse(form.token.tokenSymbol).success) errs["token.tokenSymbol"] = "2–10 letters or digits";
      if (!/^[1-9]\d{0,14}$/.test(form.token.totalSupply)) errs["token.totalSupply"] = "Whole number between 1 and 999,999,999,999,999";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep(step)) {
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const upload = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) return toast.error("Image must be 4 MB or smaller");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      update("identity", { imageId: json.id });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    for (let s = 0; s < 4; s++) {
      if (!validateStep(s)) {
        setStep(s);
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api<{ id: string; slug: string; status: string }>("/api/agents", {
        method: "POST",
        body: { ...payload, activate },
      });
      await api("/api/drafts", { method: "DELETE" }).catch(() => undefined);
      toast.success(activate ? "Agent deployed and activated" : "Agent saved", {
        description: activate ? "The first research run has been queued." : "Activate it from your dashboard when ready.",
      });
      if (form.token.planned) {
        const q = new URLSearchParams({ name: form.token.tokenName, symbol: form.token.tokenSymbol, supply: form.token.totalSupply });
        router.push(`/dashboard/agents/${res.id}?tab=token&${q}`);
      } else {
        router.push(`/dashboard/agents/${res.id}`);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "VALIDATION_ERROR") {
        setErrors(e.fieldErrors());
        toast.error("Please fix the highlighted fields");
      } else toast.error(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") {
    return (
      <Card className="flex items-center justify-center gap-3 p-16 text-muted">
        <Loader2 className="size-5 animate-spin" /> Checking your session…
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="mx-auto max-w-xl p-10 text-center">
        <Wallet className="mx-auto size-8 text-accent" />
        <h2 className="mt-4 font-display text-xl font-semibold">Connect and sign in to create an agent</h2>
        <p className="mt-2 text-sm text-muted">
          Agents are owned by your wallet. Signing in uses a gasless Sign-In with Ethereum message — RoviumPad never asks for
          your seed phrase or private key.
        </p>
        <Button variant="primary" className="mt-6" onClick={openConnect}>
          <Wallet /> Connect wallet
        </Button>
      </Card>
    );
  }

  const e = (k: string) => errors[k];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        {/* Stepper */}
        <ol className="mb-8 flex gap-2 overflow-x-auto pb-1 scrollbar-thin" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className="shrink-0">
              <button
                type="button"
                onClick={() => (i < step || validateStep(step)) && i <= step + 1 && setStep(i)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] cursor-pointer",
                  i === step ? "border-accent/40 bg-accent/10 text-accent" : i < step ? "border-border text-silver" : "border-border text-subtle",
                )}
                aria-current={i === step ? "step" : undefined}
              >
                <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px]", i < step ? "bg-success/20 text-success" : "bg-surface-2")}>
                  {i < step ? <Check className="size-3" /> : i + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <Card className="p-6 sm:p-8">
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-xl font-semibold">Agent identity</h2>
                <p className="mt-1 text-sm text-muted">Name and ticker are permanent once created.</p>
              </div>
              <div className="flex items-center gap-4">
                <AgentAvatar name={form.identity.name || "Agent"} imageId={form.identity.imageId} size={72} />
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(ev) => ev.target.files?.[0] && upload(ev.target.files[0])}
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={uploading}>
                      <ImagePlus /> {form.identity.imageId ? "Replace image" : "Upload image"}
                    </Button>
                    {form.identity.imageId && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => update("identity", { imageId: null })}>
                        <X /> Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[12px] text-subtle">PNG, JPEG, WebP or GIF up to 4 MB. Re-encoded to 512×512.</p>
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-[1fr_180px]">
                <Field label="Agent name" htmlFor="name" error={e("identity.name")}>
                  <Input id="name" value={form.identity.name} onChange={(ev) => update("identity", { name: ev.target.value })} placeholder="e.g. Treasury Sentinel" maxLength={48} aria-invalid={Boolean(e("identity.name"))} />
                </Field>
                <Field label="Ticker" htmlFor="ticker" error={e("identity.ticker")}>
                  <Input id="ticker" value={form.identity.ticker} onChange={(ev) => update("identity", { ticker: ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="TSEN" maxLength={10} className="font-mono uppercase" aria-invalid={Boolean(e("identity.ticker"))} />
                </Field>
              </div>
              <Field label="Description" htmlFor="desc" error={e("identity.description")} hint={`${form.identity.description.length}/600 · shown on the marketplace`}>
                <Textarea id="desc" value={form.identity.description} onChange={(ev) => update("identity", { description: ev.target.value })} maxLength={600} placeholder="What this agent researches and why it is useful." aria-invalid={Boolean(e("identity.description"))} />
              </Field>
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-silver">RWA specialization</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SPECIALIZATIONS.map((s) => (
                    <label
                      key={s.id}
                      className={cn(
                        "flex cursor-pointer flex-col gap-1 rounded-[12px] border p-4 transition-colors",
                        form.identity.specialization === s.id ? "border-accent/50 bg-accent/[0.06]" : "border-border hover:border-border-strong",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <input type="radio" name="spec" value={s.id} checked={form.identity.specialization === s.id} onChange={() => update("identity", { specialization: s.id })} className="accent-[#83b5ff]" />
                        <span className="font-medium">{s.label}</span>
                      </span>
                      <span className="pl-5 text-[13px] text-muted">{s.description}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <ListEditor label="Agent objectives" values={form.identity.objectives} onChange={(v) => update("identity", { objectives: v })} placeholder="e.g. Track yield spreads of tokenized T-bill funds vs official rates" max={6} errorPrefix="identity.objectives" errors={errors} hint="Public. Up to 6." />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-xl font-semibold">Agent intelligence</h2>
                <p className="mt-1 text-sm text-muted">What the agent researches, where it gets data, and how it reports.</p>
              </div>
              <ListEditor label="Research objectives" values={form.intelligence.researchObjectives} onChange={(v) => update("intelligence", { researchObjectives: v })} placeholder="e.g. Flag funds whose yield premium over T-bills exceeds 2 percentage points" max={8} errorPrefix="intelligence.researchObjectives" errors={errors} />
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-silver">Preferred data sources</legend>
                <div className="grid gap-2">
                  {PROVIDERS.map((p) => {
                    const checked = form.intelligence.dataSources.includes(p.id);
                    return (
                      <label key={p.id} className={cn("flex cursor-pointer gap-3 rounded-[12px] border p-3.5", checked ? "border-accent/40 bg-accent/[0.05]" : "border-border hover:border-border-strong")}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={p.id === "defillama-rwa"}
                          onChange={() =>
                            update("intelligence", {
                              dataSources: checked ? form.intelligence.dataSources.filter((x) => x !== p.id) : [...form.intelligence.dataSources, p.id],
                            })
                          }
                          className="mt-1 size-4 accent-[#83b5ff]"
                        />
                        <span>
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {p.name}
                            {p.id === "defillama-rwa" && <Badge>Required</Badge>}
                            {p.requiresKey && <Badge tone="warning">Needs {p.requiresKey}</Badge>}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-muted">{p.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {e("intelligence.dataSources") && <p className="mt-1 text-[12px] text-danger">{e("intelligence.dataSources")}</p>}
              </fieldset>
              {form.intelligence.dataSources.includes("web") && (
                <ListEditor label="Web pages to read (https only)" values={form.intelligence.customSourceUrls.length ? form.intelligence.customSourceUrls : [""]} onChange={(v) => update("intelligence", { customSourceUrls: v })} placeholder="https://issuer.example/attestations" max={5} errorPrefix="intelligence.customSourceUrls" errors={errors} hint="Fetched through an SSRF-protected client. Content is treated as untrusted data and can never change the agent's instructions." />
              )}
              <ListEditor label="Focus assets (optional)" values={form.intelligence.focusAssets.length ? form.intelligence.focusAssets : [""]} onChange={(v) => update("intelligence", { focusAssets: v })} placeholder="e.g. ondo, paxos-gold, BUIDL" max={10} errorPrefix="intelligence.focusAssets" errors={errors} hint="Names, symbols or DefiLlama slugs to prioritise." />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Risk sensitivity" htmlFor="risk" hint={RISK_SENSITIVITIES.find((r) => r.id === form.intelligence.riskSensitivity)?.description}>
                  <Select id="risk" value={form.intelligence.riskSensitivity} onChange={(ev) => update("intelligence", { riskSensitivity: ev.target.value })}>
                    {RISK_SENSITIVITIES.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reporting style" htmlFor="style" hint={REPORTING_STYLES.find((r) => r.id === form.intelligence.reportingStyle)?.description}>
                  <Select id="style" value={form.intelligence.reportingStyle} onChange={(ev) => update("intelligence", { reportingStyle: ev.target.value })}>
                    {REPORTING_STYLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <fieldset className="rounded-[12px] border border-border p-4">
                <legend className="px-1 text-[13px] font-medium text-silver">Monitoring criteria</legend>
                <p className="mb-4 text-[13px] text-muted">Changes beyond these thresholds raise alerts and trigger research in event-driven modes.</p>
                <div className="grid gap-4 sm:grid-cols-4">
                  {(
                    [
                      ["priceChangePct", "Price move (%)", 0.1],
                      ["yieldChangeBps", "Yield move (bps)", 5],
                      ["tvlChangePct", "Value change (%)", 1],
                      ["staleDataHours", "Stale after (h)", 1],
                    ] as const
                  ).map(([k, label, stepVal]) => (
                    <Field key={k} label={label} htmlFor={k} error={e(`intelligence.monitoringCriteria.${k}`)}>
                      <Input
                        id={k}
                        type="number"
                        step={stepVal}
                        min={stepVal}
                        value={form.intelligence.monitoringCriteria[k]}
                        onChange={(ev) => update("intelligence", { monitoringCriteria: { ...form.intelligence.monitoringCriteria, [k]: Number(ev.target.value) } })}
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-xl font-semibold">Autonomy</h2>
                <p className="mt-1 text-sm text-muted">Runs on durable background workers — your agent keeps working after you close this page.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {AUTONOMY_MODES.map((m) => (
                  <label key={m.id} className={cn("flex cursor-pointer flex-col gap-1 rounded-[12px] border p-4", form.autonomy.mode === m.id ? "border-accent/50 bg-accent/[0.06]" : "border-border hover:border-border-strong")}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="mode" checked={form.autonomy.mode === m.id} onChange={() => update("autonomy", { mode: m.id })} className="accent-[#83b5ff]" />
                      <span className="font-medium">{m.label}</span>
                    </span>
                    <span className="pl-5 text-[13px] text-muted">{m.description}</span>
                  </label>
                ))}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {(form.autonomy.mode === "SCHEDULED" || form.autonomy.mode === "CONTINUOUS") && (
                  <Field label="Research frequency" htmlFor="interval">
                    <Select id="interval" value={form.autonomy.intervalMinutes} onChange={(ev) => update("autonomy", { intervalMinutes: Number(ev.target.value) })}>
                      {SCHEDULE_INTERVALS.map((s) => (
                        <option key={s.minutes} value={s.minutes}>{s.label}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                {(form.autonomy.mode === "EVENT_TRIGGERED" || form.autonomy.mode === "CONTINUOUS") && (
                  <Field label="Monitoring frequency" htmlFor="monitor">
                    <Select id="monitor" value={form.autonomy.monitorMinutes} onChange={(ev) => update("autonomy", { monitorMinutes: Number(ev.target.value) })}>
                      {MONITOR_INTERVALS.map((s) => (
                        <option key={s.minutes} value={s.minutes}>{s.label}</option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              <Alert tone="info" title="Built-in safety limits">
                Each agent is limited to 6 runs per UTC day, 12 tool calls per run, a per-run timeout and a daily AI token budget. Agents cannot execute code, move funds or sign transactions.
              </Alert>
              {!llmConfigured && (
                <Alert tone="warning" title="No AI model configured on this deployment">
                  Research still runs: data is collected and risk is scored, and reports are written deterministically from verified facts. AI planning and narrative activate automatically once the operator configures an LLM provider.
                </Alert>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-xl font-semibold">Token configuration (optional)</h2>
                <p className="mt-1 text-sm text-muted">Agent creation and token deployment are separate. Your agent works fully without a token. If you plan one, you will deploy it from your wallet after the agent is created.</p>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-[12px] border border-border p-4">
                <span>
                  <span className="block font-medium">Plan a token launch</span>
                  <span className="text-[13px] text-muted">Fixed-supply ERC-20 deployed from your wallet on an enabled network.</span>
                </span>
                <Switch checked={form.token.planned} onCheckedChange={(v) => update("token", { planned: v, tokenName: form.token.tokenName || form.identity.name, tokenSymbol: form.token.tokenSymbol || form.identity.ticker })} aria-label="Plan a token launch" />
              </label>
              {form.token.planned && (
                <>
                  <div className="grid gap-5 sm:grid-cols-3">
                    <Field label="Token name" htmlFor="tname" error={e("token.tokenName")}>
                      <Input id="tname" value={form.token.tokenName} onChange={(ev) => update("token", { tokenName: ev.target.value })} maxLength={40} />
                    </Field>
                    <Field label="Token symbol" htmlFor="tsym" error={e("token.tokenSymbol")}>
                      <Input id="tsym" value={form.token.tokenSymbol} onChange={(ev) => update("token", { tokenSymbol: ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={10} className="font-mono" />
                    </Field>
                    <Field label="Total supply" htmlFor="tsup" error={e("token.totalSupply")} hint="Whole tokens, 18 decimals">
                      <Input id="tsup" inputMode="numeric" value={form.token.totalSupply} onChange={(ev) => update("token", { totalSupply: ev.target.value.replace(/\D/g, "") })} maxLength={15} className="font-mono" />
                    </Field>
                  </div>
                  <p className="text-[13px] text-muted">Token image: uses the agent image. Mechanism: standard fixed-supply ERC-20. Networks available: {chains.map((c) => c.name).join(", ")}.</p>
                  <Alert tone="warning" title="Token disclosure">{TOKEN_UTILITY_DISCLOSURE}</Alert>
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-xl font-semibold">Review & deploy</h2>
                <p className="mt-1 text-sm text-muted">Check the configuration. You can edit objectives, sources and schedule later from your dashboard.</p>
              </div>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                {[
                  ["Specialization", spec.label],
                  ["Autonomy", AUTONOMY_MODES.find((m) => m.id === form.autonomy.mode)?.label],
                  ["Data sources", form.intelligence.dataSources.map((d) => PROVIDERS.find((p) => p.id === d)?.name).join(", ")],
                  ["Risk sensitivity", RISK_SENSITIVITIES.find((r) => r.id === form.intelligence.riskSensitivity)?.label],
                  ["Reporting style", REPORTING_STYLES.find((r) => r.id === form.intelligence.reportingStyle)?.label],
                  ["Token", form.token.planned ? `${form.token.tokenName} ($${form.token.tokenSymbol}), ${Number(form.token.totalSupply).toLocaleString()} supply` : "Not planned"],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-[12px] text-subtle">{k}</dt>
                    <dd className="mt-0.5 text-silver">{v}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <p className="text-[12px] text-subtle">Research objectives</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-silver">
                  {clean(form.intelligence.researchObjectives).map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-[12px] border border-border p-4">
                <span>
                  <span className="block font-medium">Activate immediately</span>
                  <span className="text-[13px] text-muted">Queues the first research run and lists the agent on the marketplace.</span>
                </span>
                <Switch checked={activate} onCheckedChange={setActivate} aria-label="Activate immediately" />
              </label>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ChevronLeft /> Back
            </Button>
            <span className="hidden text-[12px] text-subtle sm:block" aria-live="polite">
              {draftState === "saving" ? "Saving draft…" : draftState === "saved" ? "Draft saved" : draftState === "error" ? "Draft not saved" : ""}
            </span>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={next}>
                Continue <ChevronRight />
              </Button>
            ) : (
              <Button variant="primary" onClick={submit} loading={submitting}>
                <Rocket /> {activate ? "Deploy agent" : "Save agent"}
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* Live preview */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-subtle">Marketplace preview</p>
        <div className="rounded-[16px] border border-border surface-sheen p-5">
          <div className="flex items-start gap-3.5">
            <AgentAvatar name={form.identity.name || "Agent"} imageId={form.identity.imageId} size={52} />
            <div className="min-w-0">
              <p className="truncate font-display font-semibold">{form.identity.name || "Your agent"}</p>
              <p className="mt-1 text-[12px] text-muted">
                <span className="font-mono text-silver">${form.identity.ticker || "TICKER"}</span> · {spec.short}
              </p>
            </div>
          </div>
          <p className="mt-4 line-clamp-3 text-sm text-muted">{form.identity.description || "Your description appears here."}</p>
          <div className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-[12px] text-subtle">
            <p>{AUTONOMY_MODES.find((m) => m.id === form.autonomy.mode)?.label}</p>
            <p>{form.intelligence.dataSources.length} data source(s)</p>
            {form.token.planned && form.token.tokenSymbol && <p className="text-accent">Token planned: ${form.token.tokenSymbol}</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
