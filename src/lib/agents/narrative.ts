import type { MacroReference, NormalizedAsset } from "@/lib/providers/types";
import type { AssetScore, SnapshotDiff } from "./scoring";
import type { Narrative } from "./schemas";
import { RISK_LEVEL_LABEL } from "./constants";

/**
 * Deterministic report writer used when no LLM is configured (or the LLM budget is
 * exhausted). Every sentence is derived mechanically from verified facts and the
 * scoring output, so it contains no model-generated interpretation.
 */

const usd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n: number, d = 2) => `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(d)}%`;

export function deterministicNarrative(input: {
  agentName: string;
  specializationLabel: string;
  assets: NormalizedAsset[];
  scores: AssetScore[];
  aggregate: { score: number; level: string; confidence: number };
  macro: MacroReference[];
  diffs: SnapshotDiff[];
  sourceIdFor: (url: string) => string | undefined;
  style: "CONCISE" | "DETAILED" | "INSTITUTIONAL";
}): Narrative {
  const { assets, scores } = input;
  const ids = (a: NormalizedAsset) => a.sources.map((s) => input.sourceIdFor(s.url)).filter((x): x is string => Boolean(x));
  const scoreOf = (k: string) => scores.find((s) => s.assetKey === k);
  const ranked = [...assets].sort((a, b) => (scoreOf(b.key)?.score ?? 0) - (scoreOf(a.key)?.score ?? 0));
  const ref = input.macro.find((m) => m.key.includes("bills")) ?? input.macro[0];

  const line = (a: NormalizedAsset) => {
    const parts: string[] = [];
    if (a.facts.referenceValueUsd) parts.push(`reported value ${usd(a.facts.referenceValueUsd.value)}`);
    if (a.facts.marketPriceUsd) parts.push(`price ${usd(a.facts.marketPriceUsd.value)}`);
    if (a.facts.publishedYieldPct) parts.push(`published yield ${pct(a.facts.publishedYieldPct.value)}`);
    return `${a.name}${a.symbol ? ` (${a.symbol})` : ""}: ${parts.length ? parts.join(", ") : "limited metrics available"}.`;
  };

  const withYield = assets.filter((a) => a.facts.publishedYieldPct);
  const withPrice = assets.filter((a) => a.facts.priceChange24hPct);
  const withLiq = assets.filter((a) => a.facts.liquidityTvlUsd || a.facts.referenceValueUsd);
  const allIds = [...new Set(assets.flatMap(ids))];
  const macroIds = input.macro.map((m) => input.sourceIdFor(m.fact.url)).filter((x): x is string => Boolean(x));

  const sections: Narrative["sections"] = {
    assetOverview: {
      text: `This run covered ${assets.length} ${input.specializationLabel.toLowerCase()} asset(s). ${assets.map(line).join(" ")}`,
      sourceIds: allIds.slice(0, 10),
    },
    issuerAnalysis: {
      text: assets
        .map((a) => `${a.issuer ?? a.name}: ${a.auditCount ? `${a.auditCount} audit(s) listed` : "no audits listed in the DefiLlama registry"}${a.website ? `, website ${a.website}` : ""}.`)
        .join(" "),
      sourceIds: allIds.slice(0, 10),
    },
    marketConditions: {
      text: withPrice.length
        ? withPrice.map((a) => `${a.name} moved ${pct(a.facts.priceChange24hPct!.value)} over 24h.`).join(" ")
        : "No 24h price data was available for the covered assets from the configured sources.",
      sourceIds: withPrice.flatMap(ids).slice(0, 10),
    },
    yieldAnalysis: {
      text: withYield.length
        ? withYield
            .map((a) => {
              const y = a.facts.publishedYieldPct!.value;
              const prem = ref ? ` (${y - ref.fact.value >= 0 ? "+" : ""}${(y - ref.fact.value).toFixed(2)} pp vs ${ref.label})` : "";
              return `${a.name} publishes ${pct(y)}${prem}.`;
            })
            .join(" ") + (ref ? "" : " No Treasury reference rate was available for comparison.")
        : "None of the covered assets publish a yield in the configured sources (expected for non-yielding assets such as gold).",
      sourceIds: [...withYield.flatMap(ids), ...macroIds].slice(0, 10),
    },
    liquidityAssessment: {
      text: withLiq.length
        ? withLiq
            .map((a) => {
              const l = a.facts.liquidityTvlUsd?.value;
              const v = a.facts.volume24hUsd?.value;
              return `${a.name}: ${l != null ? `${usd(l)} in tracked pools` : `${usd(a.facts.referenceValueUsd!.value)} reported value (pool depth not tracked)`}${v != null ? `, ${usd(v)} 24h volume` : ""}.`;
            })
            .join(" ")
        : "Liquidity data was not available from the configured sources.",
      sourceIds: withLiq.flatMap(ids).slice(0, 10),
    },
    smartContractConsiderations: {
      text: assets
        .map((a) => `${a.name} is deployed on ${a.networks.length || "an unreported number of"} network(s)${a.networks.length ? ` (${a.networks.slice(0, 5).join(", ")})` : ""}${a.tokenContracts.length ? `; registry lists contract ${a.tokenContracts[0]!.address} on ${a.tokenContracts[0]!.network}` : ""}.`)
        .join(" "),
      sourceIds: allIds.slice(0, 10),
    },
    redemptionRisks: {
      text: "Redemption terms (eligibility, notice periods, gates, minimums) are not exposed by the configured data sources. Review each issuer's offering documents before relying on redeemability.",
      sourceIds: [],
    },
    counterpartyRisks: {
      text: "Tokenized RWAs depend on issuers, custodians and administrators off-chain. Custodian identity and attestation status are not available from the configured sources and should be verified from issuer disclosures.",
      sourceIds: [],
    },
    regulatoryConsiderations: {
      text: "Regulatory status and holder eligibility are not available from the configured sources. Many tokenized securities are restricted to qualified or non-U.S. investors.",
      sourceIds: [],
    },
  };

  const keyFindings: Narrative["keyFindings"] = [];
  keyFindings.push({
    text: `Aggregate risk score ${input.aggregate.score}/100 (${RISK_LEVEL_LABEL[input.aggregate.level]}), confidence ${input.aggregate.confidence}%.`,
    sourceIds: [],
  });
  for (const a of ranked.slice(0, input.style === "CONCISE" ? 2 : 4)) {
    const s = scoreOf(a.key)!;
    const top = [...s.factors].filter((f) => f.score != null).sort((x, y) => (y.score as number) - (x.score as number))[0];
    keyFindings.push({
      text: `${a.name}: ${RISK_LEVEL_LABEL[s.level]} risk (${s.score}/100)${top ? `; largest factor: ${top.label.toLowerCase()} — ${top.rationale}` : ""}`,
      sourceIds: ids(a).slice(0, 4),
    });
  }
  const breached = input.diffs.filter((d) => d.breached);
  if (breached.length) {
    keyFindings.push({
      text: `Monitoring thresholds crossed since the previous run: ${breached
        .map((d) => `${d.name} ${d.metric} ${d.unit === "bps" ? `${d.change.toFixed(0)} bps` : pct(d.change)}`)
        .join("; ")}.`,
      sourceIds: [],
    });
  }

  const uncertainties = [
    "Redemption terms, custodians and regulatory status are not covered by the configured data sources.",
    ...(assets.some((a) => Object.values(a.facts).some((f) => f?.stale)) ? ["Some metrics are stale; see source timestamps."] : []),
    ...(assets.some((a) => !a.facts.marketPriceUsd) ? ["Some assets lack a public market price."] : []),
  ];

  const top = ranked[0];
  return {
    title: `${input.specializationLabel}: ${assets.length} asset${assets.length === 1 ? "" : "s"} reviewed`,
    summary: `${input.agentName} reviewed ${assets.length} asset(s) using verified public data. Aggregate risk is ${RISK_LEVEL_LABEL[input.aggregate.level].toLowerCase()} (${input.aggregate.score}/100) with ${input.aggregate.confidence}% confidence.${top ? ` Highest scored risk: ${top.name} (${scoreOf(top.key)?.score}/100).` : ""} This report was generated deterministically from source data without an AI narrative.`,
    sections,
    keyFindings,
    uncertainties,
  };
}
