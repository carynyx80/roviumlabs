# Architecture

```
 Browser ──► Next.js (App Router, Vercel-compatible) ──► PostgreSQL (Prisma)
   │            │  pages (RSC) + /api route handlers          ▲      ▲
   │            │  SIWE auth, validation, rate limits          │      │
   │            └── enqueue jobs ─────────► Job queue ─────────┘      │
   │                                (Postgres table | Redis+BullMQ)   │
   │                                         │                        │
   │                                 Worker (persistent Node)  ───────┘
   │                                 scheduler · consumer · sweeper
   │                                         │
   │                      ┌──────────────────┼──────────────────┐
   │                 RWA providers      LLM provider        (no keys,
   │              (DefiLlama, Treasury,  (OpenAI-compatible)  no funds)
   │               FRED, safe web fetch)
   └──► Wallet (wagmi/viem) ──► EVM chain (local Hardhat / Robinhood Chain)
                                 ▲
             server verification ┘ (viem public client)
```

## Code map

| Path | Purpose |
| --- | --- |
| `src/app` | Pages and API route handlers |
| `src/lib/auth` | SIWE nonce/verify, session cookies |
| `src/lib/agents` | Engine, lifecycle, scoring, narrative, prompts, schemas, memory, events, stats |
| `src/lib/providers` | Data provider adapters, cache, health, normalized types |
| `src/lib/llm` | OpenAI-compatible client (structured JSON, streaming, embeddings) |
| `src/lib/queue` | Job queue (Postgres SKIP LOCKED or BullMQ) |
| `src/lib/chain` | Chain registry, server RPC clients, token artifact, deployment verification |
| `src/lib/security` | SSRF-safe fetcher |
| `src/lib/server` | HTTP helpers, rate limiting, queries, agent service |
| `worker/` | Persistent worker process |
| `contracts/` | `RoviumAgentToken.sol` |
| `prisma/` | Schema and migrations (incl. raw-SQL partial unique indexes) |
| `tests/` | Unit, integration (isolated DB), contract tests |
| `scripts/` | Dev DB, dev chain, contract compile, end-to-end journey |

## Data model (PostgreSQL)

Identity: `User`, `WalletIdentity`, `AuthNonce`, `Session`. Agents: `Agent`, `AgentConfig`, `AgentSchedule`, `AgentDraft`.
Execution: `AgentExecution`, `AgentExecutionStep`, `Job`, `WorkerHeartbeat`. Research: `ResearchReport`, `ResearchSource`,
`ReportAsset`, `MonitoredAsset`, `AgentMemory`, `ProviderCache`, `ProviderHealth`. Chain: `TokenDeployment`,
`BlockchainTransaction`. Platform: `ActivityEvent`, `Notification`, `NotificationChannel`, `ChatConversation`,
`ChatMessage`, `UsageRecord`, `AuditLog`, `AgentAbuseReport`, `RateLimit`, `Media`, `AgentMarketStats`.

Integrity constraints beyond foreign keys (see `prisma/migrations`):
- one in-flight execution per agent (partial unique index)
- one confirmed and one submitted token deployment per agent (partial unique indexes)
- unique execution idempotency keys; unique report per execution; unique job dedupe keys
- range checks on scores; size limit on stored media

## Agent execution

1. **Trigger** — manual (`/run`), schedule (scheduler advances `nextRunAt` with optimistic concurrency and uses the
   slot as idempotency key), event (monitor job finds threshold breaches; one trigger per agent per hour), or activation.
2. **Queue** — `requestExecution` checks status, daily limit and concurrency, creates the execution, enqueues a job.
3. **RESEARCHING** — universe → plan (LLM chooses from candidate keys only, validated) → asset data → macro rates →
   creator pages. Every call is a trace step; tool-call budget enforced.
4. **ANALYZING** — scoring (`rovium-risk-v1`), snapshot diffs, narrative (LLM structured output validated by Zod with one
   repair attempt; deterministic writer as fallback or when budgets are exhausted).
5. **PUBLISHING** — single transaction writes the report, sources, per-asset facts/factors, snapshots, events,
   notifications, usage and execution completion. Memory is written afterwards.
6. **Failure** — provider/LLM errors are retryable (exponential backoff, 3 attempts); others fail immediately. The
   worker sweeper fails orphaned or stale executions. Cancellation and timeouts are checked between steps.

## Memory

`AgentMemory` rows (objectives, report summaries, findings, execution summaries, source references, config changes)
are always queried with `agentId`. Retrieval combines keyword overlap, recency and importance, plus cosine similarity
when `LLM_EMBEDDING_MODEL` is configured. Public chat only reads public kinds.

## Real-time

`/api/activity/stream` is a Server-Sent Events endpoint that polls PostgreSQL every 3 s and closes after 5 minutes
(EventSource reconnects with `Last-Event-ID`). This works on serverless hosts without a broker.
