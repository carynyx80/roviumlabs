import { db } from "@/lib/db";

/**
 * Fetch helper for first-party, allowlisted provider hosts only.
 * Adds timeouts, health tracking and a two-level cache (memory + PostgreSQL).
 * When a refresh fails and an expired cached value exists, the stale value is
 * returned with stale=true so callers can surface a warning instead of failing.
 */

const ALLOWED_HOSTS = new Set([
  "api.llama.fi",
  "yields.llama.fi",
  "coins.llama.fi",
  "api.fiscaldata.treasury.gov",
  "api.stlouisfed.org",
]);

export class ProviderError extends Error {
  constructor(
    public providerId: string,
    message: string,
  ) {
    super(`[${providerId}] ${message}`);
  }
}

const mem = new Map<string, { value: unknown; fetchedAt: number; expiresAt: number }>();

export interface Cached<T> {
  value: T;
  fetchedAt: Date;
  stale: boolean;
}

async function recordHealth(providerId: string, ok: boolean, latencyMs: number, error?: string) {
  try {
    await db.providerHealth.upsert({
      where: { providerId },
      create: {
        providerId,
        ok,
        latencyMs,
        lastOkAt: ok ? new Date() : null,
        lastErrorAt: ok ? null : new Date(),
        lastError: error?.slice(0, 500),
        failureCount: ok ? 0 : 1,
      },
      update: ok
        ? { ok, latencyMs, lastOkAt: new Date(), failureCount: 0 }
        : {
            ok,
            latencyMs,
            lastErrorAt: new Date(),
            lastError: error?.slice(0, 500),
            failureCount: { increment: 1 },
          },
    });
  } catch {
    // health tracking must never break data retrieval
  }
}

export async function providerFetchJson(
  providerId: string,
  url: string,
  timeoutMs = 20_000,
): Promise<unknown> {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(host)) throw new ProviderError(providerId, `host ${host} is not allowlisted`);
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "RoviumPad/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(providerId, `HTTP ${res.status}`);
    const json = await res.json();
    await recordHealth(providerId, true, Date.now() - started);
    return json;
  } catch (err) {
    const msg =
      err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : String(err);
    await recordHealth(providerId, false, Date.now() - started, msg);
    throw err instanceof ProviderError ? err : new ProviderError(providerId, msg);
  } finally {
    clearTimeout(t);
  }
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<Cached<T>> {
  const now = Date.now();
  const m = mem.get(key);
  if (m && m.expiresAt > now) return { value: m.value as T, fetchedAt: new Date(m.fetchedAt), stale: false };

  const row = await db.providerCache.findUnique({ where: { key } }).catch(() => null);
  if (row && row.expiresAt.getTime() > now) {
    mem.set(key, {
      value: row.value,
      fetchedAt: row.fetchedAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
    });
    return { value: row.value as T, fetchedAt: row.fetchedAt, stale: false };
  }

  try {
    const value = await load();
    const fetchedAt = new Date();
    const expiresAt = new Date(now + ttlMs);
    mem.set(key, { value, fetchedAt: fetchedAt.getTime(), expiresAt: expiresAt.getTime() });
    await db.providerCache
      .upsert({
        where: { key },
        create: { key, value: value as object, fetchedAt, expiresAt },
        update: { value: value as object, fetchedAt, expiresAt },
      })
      .catch(() => undefined);
    return { value, fetchedAt, stale: false };
  } catch (err) {
    const fallback =
      m ?? (row ? { value: row.value, fetchedAt: row.fetchedAt.getTime() } : undefined);
    if (fallback) return { value: fallback.value as T, fetchedAt: new Date(fallback.fetchedAt), stale: true };
    throw err;
  }
}
