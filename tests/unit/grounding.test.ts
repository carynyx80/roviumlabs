import { describe, expect, it } from "vitest";
import { allowedNumbers, dropRepeats, extractNumbers, groundCitations, groundText, similarity, type GroundingIssue } from "@/lib/agents/grounding";
import { scoreAsset } from "@/lib/agents/scoring";
import { testAsset } from "../fixtures";

describe("number extraction", () => {
  it("parses currency, percentages and magnitudes", () => {
    const v = extractNumbers("Yield 4.1%, TVL $2.00B, volume $1,500,000 and 150 bps").map((n) => n.value);
    expect(v).toEqual([4.1, 2e9, 1_500_000, 150]);
  });
});

describe("grounding", () => {
  const a = testAsset();
  const s = scoreAsset(a, { sensitivity: "BALANCED", referenceRatePct: 3.9 });
  const allowed = allowedNumbers({
    assets: [a],
    macro: [{ key: "t", label: "T", fact: { value: 3.9, providerId: "x", url: "u", asOf: "", stale: false } }],
    scores: [s],
    diffs: [],
    aggregate: { score: s.score, confidence: s.confidence },
  });

  it("keeps supported figures, including rounding and derived premia", () => {
    const issues: GroundingIssue[] = [];
    const t = groundText("The fund yields 4.1%. That is 0.2 pp above 3.9%. Reported value is $2.0B. Two assets were covered.", allowed, "x", issues);
    expect(issues).toEqual([]);
    expect(t).toContain("$2.0B");
  });

  it("removes sentences with unsupported figures", () => {
    const issues: GroundingIssue[] = [];
    const t = groundText("The fund yields 4.1%. It returned 27.5% last year.", allowed, "summary", issues);
    expect(t).toBe("The fund yields 4.1%.");
    expect(issues[0]!.kind).toBe("unsupported_number");
  });

  it("ignores citation markers and small counts", () => {
    const issues: GroundingIssue[] = [];
    groundText("Three sources [S12] support 3 findings in 2026.", allowed, "x", issues);
    expect(issues).toEqual([]);
  });

  it("does not treat score scales or dates as data claims (regression from the first live run)", () => {
    const issues: GroundingIssue[] = [];
    const text = `The aggregate risk score is ${s.score} out of 100. The fund scores ${s.score}/100 on a 0-100 scale. It yields 4.1% as of October 17, 2026 (2026-10-17), per 17 Oct 2026 data.`;
    expect(groundText(text, allowed, "x", issues)).toBe(text);
    expect(issues).toEqual([]);
  });

  it("still flags fabricated figures next to dates and scales", () => {
    const issues: GroundingIssue[] = [];
    groundText("As of October 17, 2026 the fund yielded 9.4% out of 100.", allowed, "x", issues);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.detail).toContain("9.4%");
  });

  it("drops citations that do not exist", () => {
    const issues: GroundingIssue[] = [];
    expect(groundCitations(["S1", "S9", "S1"], { S1: {}, S2: {} }, "f", issues)).toEqual(["S1"]);
    expect(issues[0]!.detail).toContain("S9");
  });
});

describe("novelty", () => {
  it("treats same wording with different numbers as different", () => {
    expect(similarity("Fund yield is 4.1% above average", "Fund yield is 4.3% above average")).toBe(1);
    const issues: GroundingIssue[] = [];
    const kept = dropRepeats(
      [{ text: "Fund yield is 4.3% above average" }, { text: "Liquidity remains deep across pools" }],
      ["Fund yield is 4.1% above average", "Liquidity remains deep across pools"],
      issues,
    );
    expect(kept.map((k) => k.text)).toEqual(["Fund yield is 4.3% above average"]);
    expect(issues).toHaveLength(1);
  });

  it("always keeps at least one finding", () => {
    expect(dropRepeats([{ text: "Same old finding here" }], ["Same old finding here"], [])).toHaveLength(1);
  });
});
