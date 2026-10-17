/** Shared, client-safe types for normalized RWA data. */

export type RwaCategory =
  | "GOLD"
  | "TREASURIES"
  | "REAL_ESTATE"
  | "PRIVATE_CREDIT"
  | "COMMODITIES"
  | "OTHER";

export interface SourceRef {
  providerId: string;
  title: string;
  url: string;
  retrievedAt: string; // ISO
  dataTimestamp?: string; // ISO, when the provider reports one
  stale: boolean;
}

/** A single verified value with attribution. Never constructed without a source. */
export interface Fact<T = number> {
  value: T;
  unit?: string;
  providerId: string;
  url: string;
  asOf: string; // ISO
  stale: boolean;
}

export interface NormalizedAsset {
  key: string; // e.g. "defillama:paxos-gold"
  name: string;
  symbol?: string;
  category: RwaCategory;
  categoryTags: string[];
  issuer?: string;
  description?: string;
  website?: string;
  networks: string[];
  tokenContracts: { network: string; address: string }[];
  auditCount?: number;
  geckoId?: string;
  listedAt?: string;
  facts: {
    marketPriceUsd?: Fact;
    priceChange24hPct?: Fact;
    referenceValueUsd?: Fact; // total value of tokenized assets (TVL / RWA mcap) as reported
    publishedYieldPct?: Fact;
    yield7dChangePct?: Fact;
    yieldMean30dPct?: Fact;
    liquidityTvlUsd?: Fact; // TVL of tracked pools for the asset
    volume24hUsd?: Fact;
  };
  /** Fields that providers do not expose; kept explicit so the UI can say "not available". */
  unavailable: string[];
  documentation: string[];
  sources: SourceRef[];
}

export interface MacroReference {
  key: string;
  label: string;
  fact: Fact;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  homepage: string;
  categories: RwaCategory[] | "ALL";
  requiresKey?: string;
}
