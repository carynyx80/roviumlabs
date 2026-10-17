import type { NormalizedAsset, MacroReference } from "@/lib/providers/types";
import type { AssetScore, SnapshotDiff } from "./scoring";

/**
 * Grounding checks applied to every AI-written report before publication:
 *  1. citations   — source ids must exist in this run's source index
 *  2. numbers     — every figure in AI text must match a value produced by an approved tool
 *                   (facts, reference rates, scores, changes, or simple derivations of them);
 *                   sentences with unsupported figures are removed and logged
 *  3. novelty     — findings that repeat earlier findings near-verbatim are dropped
 */

export interface GroundingIssue {
  kind: "invalid_citation" | "unsupported_number" | "repeated_finding" | "prohibited_claim";
  detail: string;
}

const NUM_RE = /(?<![A-Za-z#])(\$)?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s?(%|pp|bps|basis points|[kKmMbB](?:n|illion)?\b|thousand|million|billion)?/g;

export interface ExtractedNumber {
  raw: string;
  value: number;
}

export function extractNumbers(text: string): ExtractedNumber[] {
  const out: ExtractedNumber[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const raw = m[0].trim();
    let v = Number(m[2]!.replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    const unit = (m[3] ?? "").toLowerCase();
    if (unit === "%" || unit === "pp" || unit === "bps" || unit === "basis points") {
      // relative units: no magnitude scaling
    } else if (unit.startsWith("k") || unit === "thousand") v *= 1e3;
    else if (unit.startsWith("m")) v *= 1e6;
    else if (unit.startsWith("b")) v *= 1e9;
    out.push({ raw, value: v });
  }
  return out;
}

/** Values the text may legitimately mention, from verified tool outputs and their simple derivations. */
export function allowedNumbers(input: {
  assets: NormalizedAsset[];
  macro: MacroReference[];
  scores: AssetScore[];
  diffs: SnapshotDiff[];
  aggregate: { score: number; confidence: number };
  extra?: number[];
}): number[] {
  const vals: number[] = [input.aggregate.score, input.aggregate.confidence, ...(input.extra ?? [])];
  const yields: number[] = [];
  for (const a of input.assets) {
    vals.push(a.networks.length);
    if (a.auditCount != null) vals.push(a.auditCount);
    for (const f of Object.values(a.facts)) {
      if (!f) continue;
      vals.push(f.value);
    }
    if (a.facts.publishedYieldPct) yields.push(a.facts.publishedYieldPct.value);
  }
  const refs = input.macro.map((m) => m.fact.value);
  vals.push(...refs);
  for (const y of yields) for (const r of refs) vals.push(y - r, Math.abs(y - r), (y - r) * 100);
  for (const s of input.scores) {
    vals.push(s.score, s.confidence);
    for (const f of s.factors) if (f.score != null) vals.push(f.score, f.weight * 100);
  }
  for (const d of input.diffs) vals.push(d.previous, d.current, d.change, Math.abs(d.change));
  vals.push(input.assets.length, input.scores.length);
  return vals.filter((v) => Number.isFinite(v));
}

function matches(n: number, allowed: number[]) {
  const a = Math.abs(n);
  // Small integers (counts, list positions), years and methodology thresholds are not data claims.
  if (Number.isInteger(n) && a <= 12) return true;
  if (Number.isInteger(n) && a >= 1990 && a <= 2100) return true;
  return allowed.some((v) => {
    const b = Math.abs(v);
    const tol = Math.max(0.06, b * 0.02); // rounding tolerance: 2% relative or 0.06 absolute
    return Math.abs(a - b) <= tol || Math.abs(a - b / 1e9) <= Math.max(0.06, (b / 1e9) * 0.02) || Math.abs(a - b / 1e6) <= Math.max(0.06, (b / 1e6) * 0.02);
  });
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/**
 * Removes text that contains digits but is not a data claim: citation markers, dates, score
 * scales ("40/100", "out of 100", "0-100") and methodology names. Found necessary in the first
 * live run, where legitimate sentences were removed for mentioning "out of 100" or a date.
 */
export function stripNonClaims(s: string): string {
  return s
    .replace(/\[?\bS\d+\b\]?/g, " ") // citation markers
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, " ") // ISO dates
    .replace(new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"), " ") // October 17, 2026
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?(?:\\s+\\d{4})?\\b`, "gi"), " ") // 17 October 2026
    .replace(/\/\s?100\b|\bout of 100\b|\b0\s?[-–]\s?100\b/gi, " ") // score scales
    .replace(/rovium-risk-v\d+/gi, " ");
}

/** Removes sentences containing figures not supported by verified values. */
export function groundText(text: string, allowed: number[], where: string, issues: GroundingIssue[]): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z(“"'])/);
  const kept: string[] = [];
  for (const s of sentences) {
    const cleaned = stripNonClaims(s);
    const bad = extractNumbers(cleaned).filter((n) => !matches(n.value, allowed));
    if (bad.length) issues.push({ kind: "unsupported_number", detail: `${where}: removed "${s.slice(0, 160)}" (unsupported: ${bad.map((b) => b.raw).join(", ")})` });
    else kept.push(s);
  }
  return kept.join(" ").trim();
}

export function groundCitations(ids: string[], index: Record<string, unknown>, where: string, issues: GroundingIssue[]): string[] {
  const valid = ids.filter((id) => id in index);
  const invalid = ids.filter((id) => !(id in index));
  if (invalid.length) issues.push({ kind: "invalid_citation", detail: `${where}: dropped non-existent source id(s) ${invalid.join(", ")}` });
  return [...new Set(valid)];
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[\d.,%$]+/g, " ")
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2),
  );

/** Jaccard similarity of word sets, ignoring numbers (so "yield 4.1%" vs "yield 4.3%" compares as equal wording). */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Drops findings that restate a previous finding with the same wording AND the same numbers.
 * A finding with similar wording but different figures is a genuine change and is kept.
 */
export function dropRepeats<T extends { text: string; novelty?: string }>(findings: T[], previous: string[], issues: GroundingIssue[]): T[] {
  const nums = (s: string) => extractNumbers(s).map((n) => n.value.toFixed(2)).sort().join("|");
  const kept = findings.filter((f) => {
    const dup = previous.find((p) => similarity(f.text, p) >= 0.8 && nums(f.text) === nums(p));
    if (dup) issues.push({ kind: "repeated_finding", detail: `Omitted repeat of an earlier finding: "${f.text.slice(0, 140)}"` });
    return !dup;
  });
  return kept.length ? kept : findings.slice(0, 1); // always keep at least one finding
}
