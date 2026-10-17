import type { ProviderInfo } from "./types";

/** Client-safe provider catalogue shown in the creation studio and docs. */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "defillama-rwa",
    name: "DefiLlama RWA protocols",
    description:
      "Public protocol registry for tokenized real-world assets: issuers, networks, contracts, audits and reported value.",
    homepage: "https://defillama.com/protocols/RWA",
    categories: "ALL",
  },
  {
    id: "defillama-yields",
    name: "DefiLlama yields",
    description: "Published yields, pool TVL and volume for RWA pools tracked by DefiLlama.",
    homepage: "https://defillama.com/yields",
    categories: "ALL",
  },
  {
    id: "defillama-prices",
    name: "DefiLlama coin prices",
    description: "Aggregated market prices and 24h change for tokens with a CoinGecko listing.",
    homepage: "https://defillama.com/docs/api",
    categories: "ALL",
  },
  {
    id: "us-treasury",
    name: "U.S. Treasury Fiscal Data",
    description: "Official average interest rates on marketable U.S. Treasury securities (monthly).",
    homepage: "https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/",
    categories: ["TREASURIES", "PRIVATE_CREDIT", "REAL_ESTATE"],
  },
  {
    id: "fred",
    name: "FRED (St. Louis Fed)",
    description: "Daily constant-maturity Treasury yields. Requires a free FRED API key.",
    homepage: "https://fred.stlouisfed.org/docs/api/fred/",
    categories: ["TREASURIES", "PRIVATE_CREDIT", "REAL_ESTATE"],
    requiresKey: "FRED_API_KEY",
  },
  {
    id: "web",
    name: "Creator-specified web pages",
    description:
      "Up to 5 https pages you list (issuer disclosures, attestations). Fetched through an SSRF-safe client and treated as untrusted text.",
    homepage: "",
    categories: "ALL",
  },
];

export const DEFAULT_PROVIDERS = ["defillama-rwa", "defillama-yields", "defillama-prices", "us-treasury"];

export const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;
