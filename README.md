# RoviumPad

**The Launchpad for Autonomous RWA Agents.** Create, deploy and tokenize autonomous AI agents that research
tokenized real-world assets, analyze markets and publish source-cited intelligence. Built for Robinhood Chain.

> Status: functional development build. Not production-ready until the items in
> [Outstanding work](#outstanding-work--blockers) are resolved (LLM provider, Robinhood RPC provider, contract audit,
> production hosting).

---

## What works

| Area | Status |
| --- | --- |
| Wallet connect + Sign-In with Ethereum (nonce, domain binding, expiry, replay protection, revocable sessions) | Verified (tests + live journey) |
| Agent creation studio (5 steps, validation, server-side drafts, image upload, preview) | Implemented |
| Autonomous worker (scheduler, Postgres/BullMQ queue, retries, timeouts, cancellation, heartbeats, graceful shutdown) | Verified |
| Live RWA data: DefiLlama RWA registry, yields, prices; U.S. Treasury Fiscal Data; FRED (key); SSRF-safe web pages | Verified live (DefiLlama + Treasury) |
| Risk methodology v1, change detection, event-triggered research | Verified (tests) |
| Reports with sources, per-asset facts, factor breakdown, traces | Verified |
| AI planning, narrative and chat via any OpenAI-compatible API | Implemented; **not exercised live — no LLM key configured** |
| Marketplace (search, filters, sort, pagination), profiles, activity feed (SSE), notifications | Implemented |
| Creator dashboard (controls, execution traces, settings, token launch, AI usage) | Implemented |
| RoviumAgentToken (OpenZeppelin ERC-20) + server-side on-chain verification | Verified on local Hardhat chain |
| Robinhood Chain Testnet deployment | Configured from official docs; **not executed** (needs a funded testnet wallet) |
| Pons launchpad | **Not integrated** — no documented creation interface |
| Admin console (health, failed runs, abuse reports, suspend/feature/ban, audit log) | Implemented |

## Quick start (local, no Docker required)

Requirements: Node.js ≥ 20, npm. PostgreSQL binaries are provided by the `embedded-postgres` dev dependency.

```bash
npm install
cp .env.example .env            # then set SESSION_SECRET (and optionally LLM_* keys)
npm run db:dev                  # starts PostgreSQL on :5433 as a background daemon
npx prisma migrate deploy       # applies migrations
npm run worker                  # terminal 2: autonomous agent worker (health: http://localhost:8081/healthz)
npm run dev                     # terminal 3: web app on http://localhost:3000
npm run chain:dev               # optional, terminal 4: local EVM chain for token launches
```

With Docker instead: `docker compose up -d postgres redis` and set `DATABASE_URL`/`REDIS_URL` accordingly.

Stop the dev database with `npm run db:dev -- stop`.

### Database encoding

Databases **must be UTF-8** (AI output and provider data contain arbitrary Unicode). `npm run db:dev` initialises new clusters with `--encoding=UTF8 --locale=C`. If you created a cluster before this change (on Windows it may have inherited `WIN1252`), recreate the databases:

```sql
DROP DATABASE roviumpad WITH (FORCE);
CREATE DATABASE roviumpad ENCODING UTF8 LC_COLLATE C LC_CTYPE C TEMPLATE template0;
```

then run `npx prisma migrate deploy`. Managed providers (Neon, Supabase, RDS) default to UTF-8.

### Verifying the whole system

```bash
npm test                        # unit + integration (isolated test DB) + contract tests
npm run e2e:journey             # 17-step journey against the running web app, worker, DB and local chain
npm run typecheck && npm run lint
```

`npm test` needs the test database once: `CREATE DATABASE roviumpad_test;` then
`DATABASE_URL=<TEST_DATABASE_URL> npx prisma migrate deploy`.

The journey script signs in with Hardhat's publicly known test account #0 (local chain only), creates and activates an
agent, waits for the worker to publish a report from live data, checks the public profile and marketplace,
pauses/resumes, verifies authorization, deploys the token on the local chain and waits for server-side verification.

## Routes

Public: `/`, `/explore`, `/activity`, `/docs`, `/agents/[slug]` (overview), `/agents/[slug]/research`,
`/agents/[slug]/activity`, `/agents/[slug]/token`, `/agents/[slug]/chat`.
Creator: `/create`, `/dashboard`, `/dashboard/agents`, `/dashboard/agents/[id]` (tabs: overview, executions, settings,
token, usage), `/dashboard/agents/[id]/report/[reportId]`, `/dashboard/settings`. Admin: `/admin`.
API reference: see `/docs#api`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data model, agent lifecycle, queue, memory
- [Deployment](docs/DEPLOYMENT.md) — Vercel + persistent worker, Docker, environment, chains, LLM providers
- [Security](docs/SECURITY.md) — threat model and controls
- In-app docs (`/docs`) — risk methodology, ranking formula, data sources, token launch process, API

## Outstanding work / blockers

1. **LLM provider** — set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Until then, reports use the deterministic writer
   and chat returns retrieved findings only. AI paths are covered by schema validation but have not run against a real model.
2. **Robinhood Chain RPC** — public endpoints are rate-limited; configure a provider (e.g. Alchemy) in `RPC_URL_*`.
   Testnet deployment requires a funded testnet wallet and has not been executed from this environment.
3. **Contract audit** — `RoviumAgentToken` wraps audited OpenZeppelin ERC-20 but is not itself audited. Mainnet stays
   disabled (`NEXT_PUBLIC_ENABLE_MAINNET`) until reviewed.
4. **Pons** — will be integrated only via an authorized, documented interface.
5. **WalletConnect / mobile** — injected (EIP-6963) wallets are supported; WalletConnect QR pairing is not wired.
6. **External notifications** (email/Telegram/webhook) — data model exists; delivery providers not configured.
7. **Production hosting** — managed PostgreSQL, Redis, a persistent worker host, error monitoring (e.g. Sentry) and a
   dependency-audit gate in CI are required before launch (`npm audit` currently reports advisories in transitive
   wallet/hardhat dev dependencies).
