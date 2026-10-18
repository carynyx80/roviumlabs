# Deployment

RoviumPad has two runtime tiers that must be deployed separately:

| Tier | Where | Why |
| --- | --- | --- |
| Web app + API (`next build` / `next start`) | Vercel, or any Node host / the `Dockerfile` | Request-driven |
| Worker (`npm run worker` / `Dockerfile.worker`) | A persistent host: Fly.io, Railway, Render background worker, ECS, a VM, Kubernetes | Agents must keep running when no one is on the site |

Both need the same `DATABASE_URL` and (recommended) `REDIS_URL`.

## 1. Data services

- **PostgreSQL 15+** (Neon, Supabase, RDS, Cloud SQL…). Run `npx prisma migrate deploy` on every release, before the
  new web/worker versions start.
- **Redis 7** (Upstash, ElastiCache, Railway). Use `maxmemory-policy noeviction` (BullMQ requirement). Without Redis the
  queue falls back to PostgreSQL, which is fine for small deployments.

## 2. Web app on Vercel

1. Import the repository. Build command: `npm run build` (runs `prisma generate`).
2. Environment: everything in `.env.example`. Required: `DATABASE_URL`, `APP_URL`, `NEXT_PUBLIC_APP_URL`,
   `SESSION_SECRET` (≥32 random chars), `NEXT_PUBLIC_CHAINS`. Recommended: `REDIS_URL`, `RPC_URL_ROBINHOOD_TESTNET`,
   `LLM_*`, `ADMIN_WALLETS`.
3. Use a pooled connection string for serverless (e.g. Neon pooled URL or PgBouncer with `?pgbouncer=true`).
4. `/api/activity/stream` keeps connections open up to 5 minutes; on Vercel set the function `maxDuration` accordingly or
   rely on EventSource reconnects.

## 3. Worker

```bash
docker build -f Dockerfile.worker -t roviumpad-worker .
docker run -d --env-file .env -p 8081:8081 --restart unless-stopped roviumpad-worker
```

- Health check: `GET :8081/healthz` (200 when DB reachable and not draining).
- Graceful shutdown: on SIGTERM the worker stops claiming jobs, waits up to 30 s for running executions and releases
  its locks. Set the orchestrator stop timeout to ≥40 s.
- Scale horizontally: multiple workers are safe (SKIP LOCKED / BullMQ locks, optimistic schedule advancement,
  idempotent executions). Tune `WORKER_CONCURRENCY` per instance.
- Heartbeats are visible in `/admin` and `/api/health` (`workersOnline`).

## 4. Chains

Values from https://docs.robinhood.com/chain/connecting:

| Network | Chain ID | Public RPC | Explorer |
| --- | --- | --- | --- |
| Robinhood Chain Testnet | 46630 | https://rpc.testnet.chain.robinhood.com | https://explorer.testnet.chain.robinhood.com |
| Robinhood Chain | 4663 | https://rpc.mainnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |

Public RPCs are rate-limited; set `RPC_URL_ROBINHOOD_*` (server) to a provider URL with a key.

**Production runs on Robinhood Chain mainnet by default** (`NEXT_PUBLIC_CHAINS` unset → `robinhood-mainnet,robinhood-testnet`).
Mainnet token launches show the estimated gas cost and require the creator to acknowledge that real ETH is spent and the
deployment is permanent; the server rejects mainnet launches without that acknowledgement. `NEXT_PUBLIC_ENABLE_MAINNET=false`
is a kill switch that removes mainnet everywhere. `/status` shows live block height, gas price and a dry-run deployment
of the token contract for each enabled network. Token source verification: see `contracts/verification/README.md`.

The token is deployed by the creator's wallet; the platform holds no keys and needs no deployer account.
Recompile after editing the contract: `npm run contracts:compile` (writes `src/lib/chain/artifacts`).

## 5. LLM provider

Any OpenAI-compatible endpoint. Examples:

| Provider | LLM_BASE_URL | Notes |
| --- | --- | --- |
| OpenAI | https://api.openai.com/v1 | set `LLM_SUPPORTS_JSON_SCHEMA=true` |
| OpenRouter | https://openrouter.ai/api/v1 | many models incl. Anthropic Claude |
| Groq / Together | provider URL | |
| Ollama (self-hosted) | http://host:11434/v1 | any non-empty `LLM_API_KEY` |

Budgets: `AgentConfig.dailyTokenBudget` (per agent), `PLATFORM_DAILY_LLM_TOKEN_BUDGET`, `CHAT_DAILY_TOKEN_BUDGET_PER_AGENT`.

## 6. Production checklist

- [ ] Strong `SESSION_SECRET`; HTTPS only (cookies are `Secure` in production)
- [ ] `ADMIN_WALLETS` set; admin actions reviewed in the audit log
- [ ] Managed Postgres backups; Redis persistence
- [ ] Worker deployed with health checks and ≥40 s stop timeout
- [ ] Provider RPC + LLM keys stored in the platform's secret manager, never in `NEXT_PUBLIC_*`
- [ ] Error monitoring (Sentry/OpenTelemetry) wired to web and worker logs
- [ ] `npm audit` / Dependabot gate in CI; `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- [ ] Token contract audited before enabling mainnet
- [ ] Legal review of disclosures for your jurisdictions
