import type { Fact, NormalizedAsset } from "@/lib/providers/types";

const now = new Date().toISOString();
const fact = (value: number, stale = false, unit?: string): Fact => ({
  value,
  unit,
  providerId: "test",
  url: "https://example.com/source",
  asOf: now,
  stale,
});

/** Synthetic asset used ONLY inside isolated tests; never written to a non-test database. */
export function testAsset(over: Partial<NormalizedAsset> & { facts?: NormalizedAsset["facts"] } = {}): NormalizedAsset {
  return {
    key: "defillama:test-fund",
    name: "Test Treasury Fund",
    symbol: "TTF",
    category: "TREASURIES",
    categoryTags: ["Treasury Bills"],
    issuer: "Test Issuer",
    website: "https://example.com",
    networks: ["Ethereum"],
    tokenContracts: [],
    auditCount: 2,
    facts: {
      referenceValueUsd: fact(2_000_000_000, false, "USD"),
      publishedYieldPct: fact(4.1, false, "%"),
      priceChange24hPct: fact(0.1, false, "%"),
      liquidityTvlUsd: fact(1_500_000_000, false, "USD"),
      marketPriceUsd: fact(1.02, false, "USD"),
    },
    unavailable: ["redemptionRestrictions", "regulatoryStatus", "custodian"],
    documentation: ["https://example.com", "https://example.com/audit.pdf"],
    sources: [
      { providerId: "defillama-rwa", title: "Registry", url: "https://example.com/registry", retrievedAt: now, stale: false },
    ],
    ...over,
  };
}

export { fact };
