import type { NormalizedAsset } from "@/lib/providers/types";

/**
 * RoviumPad Risk Methodology v1 (documented in docs/methodology.md).
 *
 * Each asset receives factor scores in [0, 100] where higher means riskier.
 * A factor without data is excluded and its weight redistributed; missing data
 * lowers confidence rather than being guessed. The score is a transparency aid,
 * not a prediction of returns or losses.
 */

export const METHODOLOGY_VERSION = "rovium-risk-v1";

export type Sensitivity = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

export interface Factor {
  id: string;
  label: string;
  weight: number;
  score: number | null; // null = insufficient data
  rationale: string;
}

export interface AssetScore {
  assetKey: string;
  score: number;
  level: "LOW" | "MODERATE" | "ELEVATED" | "HIGH";
  confidence: number;
  factors: Factor[];
}

const SENSITIVITY_MULTIPLIER: Record<Sensitivity, number> = {
  CONSERVATIVE: 1.15,
  BALANCED: 1,
  AGGRESSIVE: 0.88,
};

export const WEIGHTS = {
  liquidity: 0.25,
  yieldPremium: 0.15,
  priceStability: 0.15,
  transparency: 0.15,
  dataQuality: 0.15,
  chainExposure: 0.15,
};

export function levelFor(score: number): AssetScore["level"] {
  if (score < 30) return "LOW";
  if (score < 50) return "MODERATE";
  if (score < 70) return "ELEVATED";
  return "HIGH";
}

const fmtUsd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString("en-US")}`;

function liquidityFactor(a: NormalizedAsset): Factor {
  const depth = a.facts.liquidityTvlUsd?.value ?? a.facts.referenceValueUsd?.value;
  if (depth == null) {
    return { id: "liquidity", label: "Liquidity & size", weight: WEIGHTS.liquidity, score: null, rationale: "No liquidity or reported value available from configured sources." };
  }
  const score = depth >= 1e9 ? 10 : depth >= 1e8 ? 25 : depth >= 1e7 ? 45 : depth >= 1e6 ? 65 : 85;
  const basis = a.facts.liquidityTvlUsd ? "tracked pool TVL" : "reported tokenized value";
  return { id: "liquidity", label: "Liquidity & size", weight: WEIGHTS.liquidity, score, rationale: `${fmtUsd(depth)} ${basis}.` };
}

function yieldFactor(a: NormalizedAsset, referenceRatePct: number | undefined): Factor {
  const y = a.facts.publishedYieldPct?.value;
  if (y == null) {
    return { id: "yieldPremium", label: "Yield premium", weight: WEIGHTS.yieldPremium, score: null, rationale: "No published yield (normal for non-yielding assets such as gold)." };
  }
  if (referenceRatePct == null) {
    const score = y > 15 ? 80 : y > 10 ? 60 : y > 6 ? 40 : 20;
    return { id: "yieldPremium", label: "Yield premium", weight: WEIGHTS.yieldPremium, score, rationale: `Published yield ${y.toFixed(2)}%; no Treasury reference available, absolute thresholds used.` };
  }
  const premium = y - referenceRatePct;
  const score = premium > 8 ? 85 : premium > 4 ? 60 : premium > 2 ? 40 : premium > -1 ? 20 : 30;
  const extra = premium < -1 ? " Yield below the Treasury reference may indicate fees or stale data." : "";
  return {
    id: "yieldPremium",
    label: "Yield premium",
    weight: WEIGHTS.yieldPremium,
    score,
    rationale: `Published yield ${y.toFixed(2)}% vs ${referenceRatePct.toFixed(2)}% Treasury reference (premium ${premium >= 0 ? "+" : ""}${premium.toFixed(2)} pp). Higher premia usually compensate for additional risk.${extra}`,
  };
}

function priceFactor(a: NormalizedAsset): Factor {
  const ch = a.facts.priceChange24hPct?.value;
  if (ch == null) {
    return { id: "priceStability", label: "Price stability (24h)", weight: WEIGHTS.priceStability, score: null, rationale: "No 24h price change available." };
  }
  const abs = Math.abs(ch);
  const score = abs < 0.5 ? 10 : abs < 2 ? 30 : abs < 5 ? 55 : 80;
  return { id: "priceStability", label: "Price stability (24h)", weight: WEIGHTS.priceStability, score, rationale: `24h price change ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%.` };
}

function transparencyFactor(a: NormalizedAsset): Factor {
  let score = 70;
  const notes: string[] = [];
  if (a.auditCount != null && a.auditCount > 0) {
    score -= Math.min(30, a.auditCount * 12);
    notes.push(`${a.auditCount} audit(s) listed`);
  } else notes.push("no audits listed in the registry");
  if (a.website) {
    score -= 10;
    notes.push("issuer website listed");
  }
  if (a.documentation.length > 1) {
    score -= 10;
    notes.push(`${a.documentation.length - 1} audit/document link(s)`);
  }
  return { id: "transparency", label: "Transparency", weight: WEIGHTS.transparency, score: Math.max(5, score), rationale: notes.join("; ") + "." };
}

function dataQualityFactor(a: NormalizedAsset): Factor {
  const facts = Object.values(a.facts).filter(Boolean);
  const stale = facts.filter((f) => f!.stale).length;
  const missing = ["marketPrice", "publishedYield", "liquidity"].filter((k) => a.unavailable.includes(k)).length;
  const score = Math.min(95, 15 + stale * 20 + missing * 15);
  return {
    id: "dataQuality",
    label: "Data quality",
    weight: WEIGHTS.dataQuality,
    score,
    rationale: `${facts.length} verified metric(s), ${stale} stale, ${missing} key metric(s) unavailable.`,
  };
}

function chainFactor(a: NormalizedAsset): Factor {
  const n = a.networks.length;
  if (!n) {
    return { id: "chainExposure", label: "Smart-contract & chain exposure", weight: WEIGHTS.chainExposure, score: null, rationale: "Networks not reported." };
  }
  // Multi-chain deployments add bridge / messaging dependencies.
  const score = n === 1 ? 25 : n <= 3 ? 40 : n <= 6 ? 55 : 70;
  return {
    id: "chainExposure",
    label: "Smart-contract & chain exposure",
    weight: WEIGHTS.chainExposure,
    score,
    rationale: `Deployed on ${n} network(s): ${a.networks.slice(0, 6).join(", ")}${n > 6 ? "…" : ""}. Each additional chain adds bridge and contract dependencies.`,
  };
}

export function scoreAsset(a: NormalizedAsset, opts: { sensitivity: Sensitivity; referenceRatePct?: number }): AssetScore {
  const factors = [
    liquidityFactor(a),
    yieldFactor(a, opts.referenceRatePct),
    priceFactor(a),
    transparencyFactor(a),
    dataQualityFactor(a),
    chainFactor(a),
  ];
  const scored = factors.filter((f) => f.score != null);
  const totalWeight = scored.reduce((s, f) => s + f.weight, 0);
  const raw = totalWeight ? scored.reduce((s, f) => s + f.weight * (f.score as number), 0) / totalWeight : 75;
  const score = Math.round(Math.min(100, Math.max(0, raw * SENSITIVITY_MULTIPLIER[opts.sensitivity])));

  const coverage = totalWeight; // fraction of methodology weight backed by data
  const staleShare = (() => {
    const f = Object.values(a.facts).filter(Boolean);
    return f.length ? f.filter((x) => x!.stale).length / f.length : 1;
  })();
  const confidence = Math.round(Math.max(5, Math.min(95, coverage * 100 - staleShare * 30)));
  return { assetKey: a.key, score, level: levelFor(score), confidence, factors };
}

/** Portfolio-level aggregate: value-weighted where reported value exists, else simple mean. */
export function aggregate(scores: AssetScore[], assets: NormalizedAsset[]): { score: number; level: AssetScore["level"]; confidence: number } {
  if (!scores.length) return { score: 75, level: "HIGH", confidence: 5 };
  const weightOf = (k: string) => assets.find((a) => a.key === k)?.facts.referenceValueUsd?.value ?? 0;
  const tw = scores.reduce((s, x) => s + weightOf(x.assetKey), 0);
  const score = tw > 0
    ? scores.reduce((s, x) => s + x.score * weightOf(x.assetKey), 0) / tw
    : scores.reduce((s, x) => s + x.score, 0) / scores.length;
  const confidence = scores.reduce((s, x) => s + x.confidence, 0) / scores.length;
  const rounded = Math.round(score);
  return { score: rounded, level: levelFor(rounded), confidence: Math.round(confidence) };
}

export interface SnapshotDiff {
  assetKey: string;
  name: string;
  metric: string;
  previous: number;
  current: number;
  change: number;
  unit: "%" | "bps" | "pct_change";
  breached: boolean;
}

export interface AssetSnapshot {
  price?: number;
  yieldPct?: number;
  valueUsd?: number;
  at: string;
}

export function snapshotOf(a: NormalizedAsset): AssetSnapshot {
  return {
    price: a.facts.marketPriceUsd?.value,
    yieldPct: a.facts.publishedYieldPct?.value,
    valueUsd: a.facts.referenceValueUsd?.value,
    at: new Date().toISOString(),
  };
}

/** Compares snapshots against monitoring thresholds. Used for event triggers and "what changed". */
export function diffSnapshots(
  name: string,
  assetKey: string,
  prev: AssetSnapshot | null | undefined,
  cur: AssetSnapshot,
  t: { priceChangePct: number; yieldChangeBps: number; tvlChangePct: number },
): SnapshotDiff[] {
  if (!prev) return [];
  const out: SnapshotDiff[] = [];
  if (prev.price && cur.price) {
    const change = ((cur.price - prev.price) / prev.price) * 100;
    out.push({ assetKey, name, metric: "price", previous: prev.price, current: cur.price, change, unit: "pct_change", breached: Math.abs(change) >= t.priceChangePct });
  }
  if (prev.yieldPct != null && cur.yieldPct != null) {
    const change = (cur.yieldPct - prev.yieldPct) * 100;
    out.push({ assetKey, name, metric: "yield", previous: prev.yieldPct, current: cur.yieldPct, change, unit: "bps", breached: Math.abs(change) >= t.yieldChangeBps });
  }
  if (prev.valueUsd && cur.valueUsd) {
    const change = ((cur.valueUsd - prev.valueUsd) / prev.valueUsd) * 100;
    out.push({ assetKey, name, metric: "reported value", previous: prev.valueUsd, current: cur.valueUsd, change, unit: "pct_change", breached: Math.abs(change) >= t.tvlChangePct });
  }
  return out;
}
