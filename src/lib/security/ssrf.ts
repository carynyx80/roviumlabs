import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import type { LookupFunction } from "node:net";

/**
 * SSRF-safe fetcher for creator-supplied URLs.
 *  - https only, default port only, no embedded credentials
 *  - every resolved address must be public (blocks loopback, RFC1918, link-local,
 *    CGNAT, metadata endpoints, multicast, reserved, IPv6 ULA/link-local, v4-mapped)
 *  - the validated IP is pinned for the connection (prevents DNS rebinding)
 *  - redirects are re-validated hop by hop, max 3
 *  - response size and time are bounded; only text/html, text/plain and JSON accepted
 */

export class SsrfError extends Error {}

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return !V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]!);
    if (lower.startsWith("::ffff:")) return false;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8:") || lower.startsWith("100::")) return false;
    return true;
  }
  return false;
}

export function validateUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  if (url.protocol !== "https:") throw new SsrfError("Only https URLs are allowed");
  if (url.username || url.password) throw new SsrfError("URLs with credentials are not allowed");
  if (url.port && url.port !== "443") throw new SsrfError("Non-standard ports are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new SsrfError("Internal hostnames are not allowed");
  }
  if (isIP(host) && !isPublicIp(host)) throw new SsrfError("Private addresses are not allowed");
  return url;
}

async function resolvePublic(host: string): Promise<{ address: string; family: number }> {
  if (isIP(host)) return { address: host, family: isIP(host) };
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new SsrfError("Host did not resolve");
  for (const a of addrs) {
    if (!isPublicIp(a.address)) throw new SsrfError("Host resolves to a non-public address");
  }
  return addrs[0]!;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export async function safeFetch(raw: string, hops = 0): Promise<SafeFetchResult> {
  if (hops > 3) throw new SsrfError("Too many redirects");
  const url = validateUrlShape(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const pinned = await resolvePublic(host);
  const pinnedLookup: LookupFunction = (_h, opts, cb) => {
    if (typeof opts === "object" && opts && "all" in opts && opts.all) {
      (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };

  return new Promise<SafeFetchResult>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        lookup: pinnedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "RoviumPad-ResearchAgent/1.0 (+https://github.com/roviumpad)",
          accept: "text/html,application/json,text/plain;q=0.9",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          safeFetch(next, hops + 1).then(resolve, reject);
          return;
        }
        const contentType = String(res.headers["content-type"] ?? "");
        if (!/^(text\/html|text\/plain|application\/json|application\/[a-z.+-]*json)/i.test(contentType)) {
          res.resume();
          reject(new SsrfError(`Unsupported content type: ${contentType || "unknown"}`));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new SsrfError("Response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({ url: url.toString(), status, contentType, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new SsrfError("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** Reduces HTML to readable text. Output is still untrusted and must be treated as data. */
export function htmlToText(html: string, maxChars = 12_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, maxChars);
}
