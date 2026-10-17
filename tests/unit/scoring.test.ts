import { describe, expect, it } from "vitest";
import { aggregate, diffSnapshots, levelFor, scoreAsset } from "@/lib/agents/scoring";
import { deterministicNarrative } from "@/lib/agents/narrative";
import { narrativeSchema } from "@/lib/agents/schemas";
import { categorize } from "@/lib/providers/defillama";
import { fact, testAsset } from "../fixtures";

describe("risk scoring", () => {
  it("scores a large, audited, single-chain fund as low risk with high confidence", () => {
    const s = scoreAsset(testAsset(), { sensitivity: "BALANCED", referenceRatePct: 3.9 });
    expect(s.level).toBe("LOW");
    expect(s.score).toBeLessThan(30);
    expect(s.confidence).toBeGreaterThan(80);
    expect(s.factors).toHaveLength(6);
  });

  it("flags large yield premia over the Treasury reference", () => {
    const a = testAsset({ facts: { ...testAsset().facts, publishedYieldPct: fact(14) } });
    const s = scoreAsset(a, { sensitivity: "BALANCED", referenceRatePct: 3.9 });
    expect(s.factors.find((f) => f.id === "yieldPremium")!.score).toBe(85);
  });

  it("excludes missing factors instead of guessing and lowers confidence", () => {
    const a = testAsset({ facts: { referenceValueUsd: fact(5_000_000) }, networks: [] });
    const s = scoreAsset(a, { sensitivity: "BALANCED" });
    const missing = s.factors.filter((f) => f.score === null).map((f) => f.id);
    expect(missing).toEqual(expect.arrayContaining(["yieldPremium", "priceStability", "chainExposure"]));
    expect(s.confidence).toBeLessThan(70);
  });

  it("applies sensitivity multipliers", () => {
    const base = testAsset({ facts: { ...testAsset().facts, priceChange24hPct: fact(4) } });
    const c = scoreAsset(base, { sensitivity: "CONSERVATIVE", referenceRatePct: 3.9 }).score;
    const b = scoreAsset(base, { sensitivity: "BALANCED", referenceRatePct: 3.9 }).score;
    const g = scoreAsset(base, { sensitivity: "AGGRESSIVE", referenceRatePct: 3.9 }).score;
    expect(c).toBeGreaterThan(b);
    expect(g).toBeLessThan(b);
  });

  it("maps scores to levels at documented boundaries", () => {
    expect([levelFor(29), levelFor(30), levelFor(49), levelFor(50), levelFor(69), levelFor(70)]).toEqual([
      "LOW",
      "MODERATE",
      "MODERATE",
      "ELEVATED",
      "ELEVATED",
      "HIGH",
    ]);
  });

  it("value-weights the aggregate score", () => {
    const big = testAsset({ key: "a" });
    const small = testAsset({ key: "b", facts: { referenceValueUsd: fact(1000) } });
    const scores = [scoreAsset(big, { sensitivity: "BALANCED" }), scoreAsset(small, { sensitivity: "BALANCED" })];
    const agg = aggregate(scores, [big, small]);
    expect(Math.abs(agg.score - scores[0]!.score)).toBeLessThanOrEqual(1);
  });

  it("detects threshold breaches between snapshots", () => {
    const t = { priceChangePct: 2, yieldChangeBps: 50, tvlChangePct: 10 };
    const diffs = diffSnapshots("X", "k", { price: 100, yieldPct: 4, valueUsd: 1000, at: "" }, { price: 103, yieldPct: 4.2, valueUsd: 1050, at: "" }, t);
    expect(diffs.find((d) => d.metric === "price")!.breached).toBe(true);
    expect(diffs.find((d) => d.metric === "yield")!.breached).toBe(false);
    expect(diffs.find((d) => d.metric === "yield")!.change).toBeCloseTo(20);
    expect(diffSnapshots("X", "k", null, { at: "" }, t)).toEqual([]);
  });
});

describe("deterministic narrative", () => {
  it("produces schema-valid output that states unavailable data plainly", () => {
    const a = testAsset();
    const s = scoreAsset(a, { sensitivity: "BALANCED", referenceRatePct: 3.9 });
    const n = deterministicNarrative({
      agentName: "Test",
      specializationLabel: "Tokenized treasuries",
      assets: [a],
      scores: [s],
      aggregate: aggregate([s], [a]),
      macro: [],
      diffs: [],
      sourceIdFor: () => "S1",
      style: "DETAILED",
    });
    expect(narrativeSchema.safeParse(n).success).toBe(true);
    expect(n.sections.redemptionRisks.text).toMatch(/not exposed by the configured data sources/);
    expect(n.summary).toMatch(/without an AI narrative/);
  });
});

describe("categorize", () => {
  it.each([
    [{ name: "Paxos Gold", tags: ["Commodities"] }, "GOLD"],
    [{ name: "Copper Token", tags: ["Commodities"] }, "COMMODITIES"],
    [{ name: "BUIDL", tags: ["Treasury Bills"] }, "TREASURIES"],
    [{ name: "RealT", tags: ["Real Estate"] }, "REAL_ESTATE"],
    [{ name: "Maple", tags: ["Private Credit"] }, "PRIVATE_CREDIT"],
    [{ name: "Unknown", tags: [] }, "OTHER"],
  ])("%o → %s", (p, cat) => expect(categorize(p)).toBe(cat));
});
