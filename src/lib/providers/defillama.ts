import type { Fact, NormalizedAsset, RwaCategory, SourceRef } from "./types";
import { cached, providerFetchJson } from "./http";

/**
 * DefiLlama adapters (public, keyless):
 *  - https://api.llama.fi/protocols         protocol registry, filtered to category "RWA"
 *  - https://yields.llama.fi/pools          pools; filtered to RWA protocol slugs
 *  - https://coins.llama.fi/prices/current  token prices by coingecko id
 *  - https://coins.llama.fi/percentage      24h price change
 * Only fields present in the responses are mapped; nothing is estimated.
 */

export interface LlamaProtocol {
  name: string;
  slug: string;
  symbol?: string;
  url?: string;
  description?: string;
  address?: string | null;
  chain?: string;
  chains?: string[];
  audits?: string | null;
  gecko_id?: string | null;
  tags?: string[];
  category?: string;
  tvl?: number | null;
  mcap?: number | null;
  listedAt?: number;
  audit_links?: string[];
}

export interface LlamaPool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyPct7D: number | null;
  apyMean30d: number | null;
  volumeUsd1d: number | null;
}

type PriceMap = Record<string, { price: number; timestamp: number; change24h?: number }>;

const HOUR = 3600_000;

export function categorize(p: { name: string; tags?: string[] }): RwaCategory {
  const tags = p.tags ?? [];
  if (tags.includes("Commodities") && /gold|xau|paxg/i.test(p.name)) return "GOLD";
  if (tags.includes("Treasury Bills") || tags.includes("Money Market Funds")) return "TREASURIES";
  if (tags.includes("Real Estate")) return "REAL_ESTATE";
  if (tags.includes("Private Credit")) return "PRIVATE_CREDIT";
  if (tags.includes("Commodities")) return "COMMODITIES";
  return "OTHER";
}

export async function getRwaProtocols() {
  return cached<LlamaProtocol[]>("defillama:rwa-protocols", 30 * 60_000, async () => {
    const all = (await providerFetchJson(
      "defillama-rwa",
      "https://api.llama.fi/protocols",
      30_000,
    )) as LlamaProtocol[];
    if (!Array.isArray(all)) throw new Error("unexpected protocols payload");
    // Keep a compact projection so the cache row stays small.
    return all
      .filter((p) => p.category === "RWA")
      .map((p) => ({
        name: p.name,
        slug: p.slug,
        symbol: p.symbol && p.symbol !== "-" ? p.symbol : undefined,
        url: p.url || undefined,
        description: p.description?.slice(0, 600),
        address: p.address ?? null,
        chain: p.chain,
        chains: p.chains ?? [],
        audits: p.audits ?? null,
        gecko_id: p.gecko_id ?? null,
        tags: p.tags ?? [],
        tvl: p.tvl ?? null,
        mcap: p.mcap ?? null,
        listedAt: p.listedAt,
        audit_links: (p.audit_links ?? []).slice(0, 5),
      }));
  });
}

export async function getRwaPools(slugs: Set<string>) {
  return cached<LlamaPool[]>("defillama:rwa-pools", 30 * 60_000, async () => {
    const res = (await providerFetchJson("defillama-yields", "https://yields.llama.fi/pools", 30_000)) as {
      data?: LlamaPool[];
    };
    if (!Array.isArray(res.data)) throw new Error("unexpected pools payload");
    return res.data
      .filter((p) => slugs.has(p.project))
      .map((p) => ({
        pool: p.pool,
        chain: p.chain,
        project: p.project,
        symbol: p.symbol,
        tvlUsd: p.tvlUsd,
        apy: p.apy,
        apyBase: p.apyBase,
        apyPct7D: p.apyPct7D,
        apyMean30d: p.apyMean30d,
        volumeUsd1d: p.volumeUsd1d,
      }));
  });
}

export async function getPrices(geckoIds: string[]) {
  const ids = [...new Set(geckoIds)].sort();
  if (!ids.length) return { value: {} as PriceMap, fetchedAt: new Date(), stale: false };
  const coins = ids.map((i) => `coingecko:${i}`).join(",");
  return cached<PriceMap>(`defillama:prices:${ids.join(",")}`, 5 * 60_000, async () => {
    const [cur, pct] = await Promise.all([
      providerFetchJson("defillama-prices", `https://coins.llama.fi/prices/current/${coins}`) as Promise<{
        coins: Record<string, { price: number; timestamp: number }>;
      }>,
      (
        providerFetchJson(
          "defillama-prices",
          `https://coins.llama.fi/percentage/${coins}?period=24h`,
        ) as Promise<{ coins: Record<string, number> }>
      ).catch(() => ({ coins: {} as Record<string, number> })),
    ]);
    const out: PriceMap = {};
    for (const [k, v] of Object.entries(cur.coins ?? {})) {
      const id = k.replace("coingecko:", "");
      out[id] = { price: v.price, timestamp: v.timestamp, change24h: pct.coins?.[k] };
    }
    return out;
  });
}

function fact(value: number, providerId: string, url: string, asOf: Date, stale: boolean, unit?: string): Fact {
  return { value, unit, providerId, url, asOf: asOf.toISOString(), stale };
}

const protocolSize = (p: LlamaProtocol) => Math.max(p.tvl ?? 0, p.mcap ?? 0);

/** Lists candidate assets (lightweight) for planning. */
export async function listUniverse(categories: RwaCategory[] | "ALL") {
  const protocols = await getRwaProtocols();
  return {
    stale: protocols.stale,
    fetchedAt: protocols.fetchedAt,
    items: protocols.value
      .map((p) => ({ p, category: categorize(p) }))
      .filter(({ category }) => categories === "ALL" || categories.includes(category))
      .sort((a, b) => protocolSize(b.p) - protocolSize(a.p)),
  };
}

/** Builds normalized assets for the selected protocol slugs, joining registry, pool and price data. */
export async function loadRwaAssets(opts: {
  slugs: string[];
  include: { yields: boolean; prices: boolean };
  staleAfterHours: number;
}): Promise<{ assets: NormalizedAsset[]; warnings: string[] }> {
  const warnings: string[] = [];
  const protocols = await getRwaProtocols();
  if (protocols.stale) warnings.push("DefiLlama protocol registry unavailable; using cached data.");
  const wanted = new Set(opts.slugs);
  const universe = protocols.value.filter((p) => wanted.has(p.slug));

  const pools = opts.include.yields
    ? await getRwaPools(new Set(protocols.value.map((p) => p.slug))).catch((e: Error) => {
        warnings.push(`Yield data unavailable: ${e.message}`);
        return null;
      })
    : null;
  if (pools?.stale) warnings.push("DefiLlama yields unavailable; using cached data.");

  const geckoIds = universe.map((p) => p.gecko_id).filter((g): g is string => Boolean(g));
  const prices = opts.include.prices
    ? await getPrices(geckoIds).catch((e: Error) => {
        warnings.push(`Price data unavailable: ${e.message}`);
        return null;
      })
    : null;
  if (prices?.stale) warnings.push("DefiLlama prices unavailable; using cached data.");

  const staleMs = opts.staleAfterHours * HOUR;
  const assets = universe.map((p) => buildAsset(p, protocols, pools, prices, staleMs));
  return { assets, warnings };
}

function buildAsset(
  p: LlamaProtocol,
  protocols: { fetchedAt: Date; stale: boolean },
  pools: { value: LlamaPool[]; fetchedAt: Date; stale: boolean } | null,
  prices: { value: PriceMap; fetchedAt: Date; stale: boolean } | null,
  staleMs: number,
): NormalizedAsset {
  const category = categorize(p);
  const protoUrl = `https://defillama.com/protocol/${p.slug}`;
  const regStale = protocols.stale || Date.now() - protocols.fetchedAt.getTime() > staleMs;
  const sources: SourceRef[] = [
    {
      providerId: "defillama-rwa",
      title: `DefiLlama protocol page: ${p.name}`,
      url: protoUrl,
      retrievedAt: protocols.fetchedAt.toISOString(),
      stale: regStale,
    },
  ];
  const facts: NormalizedAsset["facts"] = {};
  const reported = protocolSize(p);
  if (reported > 0) {
    facts.referenceValueUsd = fact(reported, "defillama-rwa", protoUrl, protocols.fetchedAt, regStale, "USD");
  }

  const myPools = (pools?.value ?? []).filter((x) => x.project === p.slug);
  if (pools && myPools.length) {
    const top = [...myPools].sort((a, b) => b.tvlUsd - a.tvlUsd)[0]!;
    const yUrl = `https://defillama.com/yields/pool/${top.pool}`;
    const yStale = pools.stale;
    if (top.apy != null) facts.publishedYieldPct = fact(top.apy, "defillama-yields", yUrl, pools.fetchedAt, yStale, "%");
    if (top.apyPct7D != null) {
      facts.yield7dChangePct = fact(top.apyPct7D, "defillama-yields", yUrl, pools.fetchedAt, yStale, "pp");
    }
    if (top.apyMean30d != null) {
      facts.yieldMean30dPct = fact(top.apyMean30d, "defillama-yields", yUrl, pools.fetchedAt, yStale, "%");
    }
    const poolTvl = myPools.reduce((s, x) => s + (x.tvlUsd || 0), 0);
    facts.liquidityTvlUsd = fact(poolTvl, "defillama-yields", yUrl, pools.fetchedAt, yStale, "USD");
    if (myPools.some((x) => x.volumeUsd1d != null)) {
      const vol = myPools.reduce((s, x) => s + (x.volumeUsd1d || 0), 0);
      facts.volume24hUsd = fact(vol, "defillama-yields", yUrl, pools.fetchedAt, yStale, "USD");
    }
    sources.push({
      providerId: "defillama-yields",
      title: `DefiLlama yields: ${top.symbol} on ${top.chain}`,
      url: yUrl,
      retrievedAt: pools.fetchedAt.toISOString(),
      stale: yStale,
    });
  }

  const pr = p.gecko_id ? prices?.value[p.gecko_id] : undefined;
  if (pr && prices) {
    const asOf = new Date(pr.timestamp * 1000);
    const pStale = prices.stale || Date.now() - asOf.getTime() > staleMs;
    const pUrl = `https://www.coingecko.com/en/coins/${p.gecko_id}`;
    facts.marketPriceUsd = fact(pr.price, "defillama-prices", pUrl, asOf, pStale, "USD");
    if (typeof pr.change24h === "number") {
      facts.priceChange24hPct = fact(pr.change24h, "defillama-prices", pUrl, asOf, pStale, "%");
    }
    sources.push({
      providerId: "defillama-prices",
      title: `Market price via DefiLlama (coingecko:${p.gecko_id})`,
      url: pUrl,
      retrievedAt: prices.fetchedAt.toISOString(),
      dataTimestamp: asOf.toISOString(),
      stale: pStale,
    });
  }

  const contracts: { network: string; address: string }[] = [];
  if (p.address) {
    const parts = p.address.split(":");
    const [net, addr] = parts.length === 2 ? parts : [p.chain ?? "unknown", p.address];
    if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) contracts.push({ network: net!, address: addr });
  }
  const auditCount = p.audits != null && /^\d+$/.test(p.audits) ? Number(p.audits) : undefined;

  const unavailable = ["redemptionRestrictions", "regulatoryStatus", "custodian"];
  if (!facts.marketPriceUsd) unavailable.push("marketPrice");
  if (!facts.publishedYieldPct) unavailable.push("publishedYield");
  if (!facts.liquidityTvlUsd) unavailable.push("liquidity");

  return {
    key: `defillama:${p.slug}`,
    name: p.name,
    symbol: p.symbol,
    category,
    categoryTags: p.tags ?? [],
    issuer: p.name,
    description: p.description,
    website: p.url,
    networks: p.chains ?? [],
    tokenContracts: contracts,
    auditCount,
    geckoId: p.gecko_id ?? undefined,
    listedAt: p.listedAt ? new Date(p.listedAt * 1000).toISOString() : undefined,
    facts,
    unavailable,
    documentation: [p.url, ...(p.audit_links ?? [])].filter((x): x is string => Boolean(x)),
    sources,
  };
}
