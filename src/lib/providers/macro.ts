import type { MacroReference, SourceRef } from "./types";
import { cached, providerFetchJson } from "./http";

/**
 * Macro reference rates used to contextualize RWA yields.
 *  - U.S. Treasury Fiscal Data "Average Interest Rates on U.S. Treasury Securities" (keyless, monthly)
 *  - FRED constant-maturity yields (requires FRED_API_KEY, daily)
 */

const TREASURY_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates" +
  "?sort=-record_date&page%5Bsize%5D=20&filter=security_type_desc:eq:Marketable";
const TREASURY_PAGE =
  "https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/";

interface TreasuryRow {
  record_date: string;
  security_desc: string;
  avg_interest_rate_amt: string;
}

export async function treasuryAverageRates(): Promise<{ refs: MacroReference[]; source: SourceRef }> {
  const res = await cached<TreasuryRow[]>("treasury:avg-rates", 12 * 3600_000, async () => {
    const json = (await providerFetchJson("us-treasury", TREASURY_URL)) as { data?: TreasuryRow[] };
    if (!Array.isArray(json.data)) throw new Error("unexpected treasury payload");
    return json.data.map((r) => ({
      record_date: r.record_date,
      security_desc: r.security_desc,
      avg_interest_rate_amt: r.avg_interest_rate_amt,
    }));
  });
  const latestDate = res.value[0]?.record_date;
  const rows = res.value.filter((r) => r.record_date === latestDate);
  // Monthly dataset: anything older than ~45 days is stale.
  const stale = res.stale || (latestDate ? Date.now() - new Date(latestDate).getTime() > 45 * 86400_000 : true);
  const wanted = ["Treasury Bills", "Treasury Notes", "Treasury Bonds"];
  const refs: MacroReference[] = rows
    .filter((r) => wanted.includes(r.security_desc))
    .map((r) => ({
      key: `treasury:${r.security_desc.toLowerCase().replace(/\s+/g, "-")}`,
      label: `Avg. interest rate, ${r.security_desc} (${r.record_date})`,
      fact: {
        value: Number(r.avg_interest_rate_amt),
        unit: "%",
        providerId: "us-treasury",
        url: TREASURY_PAGE,
        asOf: new Date(r.record_date).toISOString(),
        stale,
      },
    }))
    .filter((r) => Number.isFinite(r.fact.value));
  return {
    refs,
    source: {
      providerId: "us-treasury",
      title: "U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities",
      url: TREASURY_PAGE,
      retrievedAt: res.fetchedAt.toISOString(),
      dataTimestamp: latestDate ? new Date(latestDate).toISOString() : undefined,
      stale,
    },
  };
}

const FRED_SERIES: Record<string, string> = {
  DGS3MO: "3-Month Treasury constant maturity yield",
  DGS2: "2-Year Treasury constant maturity yield",
  DGS10: "10-Year Treasury constant maturity yield",
};

export async function fredRates(apiKey: string): Promise<{ refs: MacroReference[]; sources: SourceRef[] }> {
  const refs: MacroReference[] = [];
  const sources: SourceRef[] = [];
  for (const [series, label] of Object.entries(FRED_SERIES)) {
    const res = await cached<{ date: string; value: string }[]>(`fred:${series}`, 6 * 3600_000, async () => {
      const url =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${series}` +
        `&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=10`;
      const json = (await providerFetchJson("fred", url)) as { observations?: { date: string; value: string }[] };
      if (!Array.isArray(json.observations)) throw new Error("unexpected FRED payload");
      return json.observations.map((o) => ({ date: o.date, value: o.value }));
    });
    const obs = res.value.find((o) => o.value !== "." && Number.isFinite(Number(o.value)));
    if (!obs) continue;
    const page = `https://fred.stlouisfed.org/series/${series}`;
    const stale = res.stale || Date.now() - new Date(obs.date).getTime() > 7 * 86400_000;
    refs.push({
      key: `fred:${series}`,
      label: `${label} (${obs.date})`,
      fact: { value: Number(obs.value), unit: "%", providerId: "fred", url: page, asOf: new Date(obs.date).toISOString(), stale },
    });
    sources.push({
      providerId: "fred",
      title: `FRED ${series}: ${label}`,
      url: page,
      retrievedAt: res.fetchedAt.toISOString(),
      dataTimestamp: new Date(obs.date).toISOString(),
      stale,
    });
  }
  return { refs, sources };
}
