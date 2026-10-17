# Security

## Assets and trust boundaries

- **User wallets** — never touched. RoviumPad requests only SIWE signatures and user-initiated deployments.
  No seed phrases, private keys or custody. No server deployer key exists.
- **Sessions** — random 256-bit tokens; only SHA-256 hashes are stored. httpOnly, SameSite=Lax, Secure in production,
  revocable from settings, invalidated on ban.
- **Agent configuration** — writable only by the owner (or admin), enforced server-side in `requireOwnedAgent`.
- **External content** — DefiLlama/Treasury/FRED responses, creator web pages, public chat questions: all untrusted.

## Controls

| Threat | Control |
| --- | --- |
| Signature replay / phishing | EIP-4361 domain + URI check, single-use DB nonce consumed atomically, 10-min expiry, enabled-chain check; ERC-1271/6492 fallback for smart accounts |
| CSRF | Origin/Referer must match host for all non-GET `/api/*` (middleware) + SameSite cookies |
| XSS | React escaping; no `dangerouslySetInnerHTML`; uploaded images re-encoded and served with `nosniff` + `sandbox` CSP; external links `rel=noopener noreferrer nofollow` |
| Clickjacking | `X-Frame-Options: DENY` |
| SSRF | Provider calls restricted to an allowlist; creator URLs: https only, default port, no credentials, DNS resolved and every address checked against private/reserved ranges, IP pinned for the connection, redirects re-validated (max 3), 12 s timeout, 1.5 MB cap, text/JSON only |
| Prompt injection | Fixed system prompts; creator config, memory, web pages and chat questions wrapped in `<untrusted_data>` with tag neutralization; the model has no tools; plans constrained to known asset keys; outputs schema-validated; prohibited-claim filter; numbers displayed from verified facts, not model text |
| Runaway agents / cost | Daily run limit, tool-call budget, execution timeout, one in-flight run per agent (DB index), hourly event-trigger bucket, per-agent and platform token budgets, chat rate limits |
| Abuse | Rate limits (Postgres fixed window) on auth, creation, uploads, runs, chat, reports; abuse reports; admin suspend/ban with audit log |
| Upload attacks | 4 MB limit, magic-byte sniffing, `limitInputPixels`, full WebP re-encode (strips metadata/polyglots), DB-side size check |
| Data integrity | Transactions for publish/token/admin flows; idempotency keys; partial unique indexes; Zod validation of every input |
| Secrets | Validated server env (`src/lib/env.ts`, `server-only`); RPC keys only in non-public vars; no secrets in client bundles |
| Fake token claims | Deployment stored only after receipt, sender, bytecode prefix and on-chain state match the prepared launch |

## Smart contracts

`contracts/RoviumAgentToken.sol` — OpenZeppelin v5 ERC-20, fixed supply minted to the creator, no owner/admin/mint/
pause/upgrade/fees. Tests cover supply, revert conditions, absence of privileged functions and verifier rejection
cases. **Requires an independent audit before mainnet.** Autonomous trading or custody is intentionally not
implemented; any future execution layer must use explicit user authorization, allowlisted contracts, spending limits
and independent review.

## Known gaps

- No WAF/bot protection beyond rate limits; add at the edge (Vercel Firewall, Cloudflare).
- Rate limiting is per IP/user; distributed abuse needs edge controls.
- `npm audit` reports advisories in transitive dev/wallet dependencies; track and upgrade.
- External notification channels are modelled but not implemented.
