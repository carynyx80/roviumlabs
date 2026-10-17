/**
 * Integration tests: real PostgreSQL (isolated test database), mocked data providers.
 * These verify engine/lifecycle/queue behaviour; they are NOT live provider integrations.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testAsset } from "../fixtures";

const providerState = { fail: false, price: 1.02 };

vi.mock("@/lib/providers/defillama", async (orig) => {
  const real = await orig<typeof import("@/lib/providers/defillama")>();
  const { ProviderError } = await import("@/lib/providers/http");
  return {
    ...real,
    listUniverse: vi.fn(async () => {
      if (providerState.fail) throw new ProviderError("defillama-rwa", "HTTP 503");
      return {
        stale: false,
        fetchedAt: new Date(),
        items: [
          { p: { name: "Test Treasury Fund", slug: "test-fund", tvl: 2e9 }, category: "TREASURIES" },
          { p: { name: "Second Fund", slug: "second-fund", tvl: 1e8 }, category: "TREASURIES" },
        ],
      };
    }),
    loadRwaAssets: vi.fn(async ({ slugs }: { slugs: string[] }) => ({
      warnings: [],
      assets: slugs.map((s) => {
        const base = testAsset({ key: `defillama:${s}`, name: s === "test-fund" ? "Test Treasury Fund" : "Second Fund" });
        base.facts.marketPriceUsd = { ...base.facts.marketPriceUsd!, value: providerState.price };
        return base;
      }),
    })),
  };
});
vi.mock("@/lib/providers/macro", () => ({
  treasuryAverageRates: vi.fn(async () => ({
    refs: [
      {
        key: "treasury:treasury-bills",
        label: "Avg. interest rate, Treasury Bills (test)",
        fact: { value: 3.9, unit: "%", providerId: "us-treasury", url: "https://example.com/treasury", asOf: new Date().toISOString(), stale: false },
      },
    ],
    source: { providerId: "us-treasury", title: "Treasury (test)", url: "https://example.com/treasury", retrievedAt: new Date().toISOString(), stale: false },
  })),
  fredRates: vi.fn(async () => ({ refs: [], sources: [] })),
}));

const { db } = await import("@/lib/db");
const { createAgent, requireOwnedAgent } = await import("@/lib/server/agents");
const { requestExecution, transitionAgent, LifecycleError } = await import("@/lib/agents/lifecycle");
const { runExecution, runMonitor } = await import("@/lib/agents/engine");
const { claimJobs, failJob, enqueue } = await import("@/lib/queue");
const { listMarketplace } = await import("@/lib/server/queries");
const { createAgentSchema } = await import("@/lib/agents/validation");
type Session = Awaited<ReturnType<typeof import("@/lib/auth/session").requireSession>>;

async function reset() {
  await db.$executeRawUnsafe(
    `TRUNCATE "User","Agent","Job","ActivityEvent","ProviderCache","ProviderHealth","RateLimit","AuthNonce","WorkerHeartbeat" CASCADE`,
  );
}

async function makeUser(address: string): Promise<Session> {
  const user = await db.user.create({ data: { wallets: { create: { address, chainId: 31337 } } } });
  return { userId: user.id, address, chainId: 31337, user } as unknown as Session;
}

const input = (over: Record<string, unknown> = {}) =>
  createAgentSchema.parse({
    identity: {
      name: "Integration Treasury Agent",
      ticker: "ITA",
      description: "Integration-test agent researching tokenized treasury funds.",
      specialization: "TREASURIES",
      objectives: ["Track tokenized T-bill funds"],
    },
    intelligence: {
      researchObjectives: ["Compare yields with Treasury averages"],
      dataSources: ["defillama-rwa", "defillama-yields", "defillama-prices", "us-treasury"],
      riskSensitivity: "BALANCED",
      reportingStyle: "CONCISE",
      monitoringCriteria: { priceChangePct: 2, yieldChangeBps: 50, tvlChangePct: 10, staleDataHours: 48 },
    },
    autonomy: { mode: "CONTINUOUS", intervalMinutes: 360, monitorMinutes: 30 },
    ...over,
  });

let alice: Session;
let mallory: Session;

beforeAll(async () => {
  await db.$queryRaw`SELECT 1`;
});
beforeEach(async () => {
  providerState.fail = false;
  providerState.price = 1.02;
  await reset();
  alice = await makeUser("0x00000000000000000000000000000000000a11ce");
  mallory = await makeUser("0x000000000000000000000000000000000000bad0");
});
afterAll(async () => {
  await reset();
  await db.$disconnect();
});

describe("agent creation and activation", () => {
  it("persists config, schedule, memory and an AGENT_CREATED event; activation queues one run", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    const full = await db.agent.findUniqueOrThrow({ where: { id: agent.id }, include: { config: true, schedule: true } });
    expect(full.status).toBe("ACTIVE");
    expect(full.config!.dataSources).toContain("us-treasury");
    expect(full.schedule!.nextRunAt).not.toBeNull();
    expect(full.schedule!.nextMonitorAt).not.toBeNull();
    expect(await db.agentMemory.count({ where: { agentId: agent.id, kind: "OBJECTIVE" } })).toBe(2);
    expect(await db.activityEvent.count({ where: { agentId: agent.id, type: { in: ["AGENT_CREATED", "AGENT_ACTIVATED"] } } })).toBe(2);
    const execs = await db.agentExecution.findMany({ where: { agentId: agent.id } });
    expect(execs).toHaveLength(1);
    expect(await db.job.count({ where: { type: "research" } })).toBe(1);
  });

  it("drafts are private and not listed in the marketplace", async () => {
    await createAgent(alice, input());
    const m = await listMarketplace({ q: "Integration" });
    expect(m.total).toBe(0);
  });
});

describe("authorization boundaries", () => {
  it("rejects other users", async () => {
    const agent = await createAgent(alice, input());
    await expect(requireOwnedAgent(mallory, agent.id)).rejects.toMatchObject({ status: 403 });
    await expect(requireOwnedAgent(alice, agent.id)).resolves.toMatchObject({ id: agent.id });
  });
  it("lets admins through", async () => {
    const agent = await createAgent(alice, input());
    const admin = { ...mallory, user: { ...mallory.user, role: "ADMIN" } } as Session;
    await expect(requireOwnedAgent(admin, agent.id)).resolves.toMatchObject({ id: agent.id });
  });
});

describe("execution engine", () => {
  it("runs the full lifecycle and publishes a sourced report", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    const exec = await db.agentExecution.findFirstOrThrow({ where: { agentId: agent.id } });
    const result = await runExecution(exec.id);
    expect(result).toHaveProperty("reportId");

    const done = await db.agentExecution.findUniqueOrThrow({ where: { id: exec.id }, include: { steps: { orderBy: { index: "asc" } } } });
    expect(done.status).toBe("COMPLETED");
    expect(done.steps.map((s) => s.name)).toEqual(
      expect.arrayContaining(["rwa.list_universe", "plan.finalize", "rwa.load_assets", "macro.treasury_avg_rates", "risk.score", "report.publish"]),
    );
    const report = await db.researchReport.findUniqueOrThrow({ where: { executionId: exec.id }, include: { sources: true, assets: true } });
    expect(report.narrativeBy).toBe("deterministic");
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.assets.length).toBe(2);
    expect(report.riskScore).toBeGreaterThanOrEqual(0);
    expect(await db.monitoredAsset.count({ where: { agentId: agent.id } })).toBe(2);
    expect(await db.notification.count({ where: { userId: alice.userId, kind: "report" } })).toBe(1);
    expect(await db.agentMemory.count({ where: { agentId: agent.id, kind: "REPORT_SUMMARY" } })).toBe(1);
    expect(await db.activityEvent.count({ where: { agentId: agent.id, type: "REPORT_PUBLISHED" } })).toBe(1);
  });

  it("is idempotent: re-delivering a completed execution does nothing", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    const exec = await db.agentExecution.findFirstOrThrow({ where: { agentId: agent.id } });
    await runExecution(exec.id);
    expect(await runExecution(exec.id)).toEqual({ skipped: "terminal" });
    expect(await db.researchReport.count({ where: { agentId: agent.id } })).toBe(1);
  });

  it("enforces one in-flight execution per agent", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    await expect(requestExecution({ agentId: agent.id, trigger: "MANUAL" })).rejects.toBeInstanceOf(LifecycleError);
  });

  it("enforces the daily run limit", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    await db.agentConfig.update({ where: { agentId: agent.id }, data: { dailyRunLimit: 1 } });
    const exec = await db.agentExecution.findFirstOrThrow({ where: { agentId: agent.id } });
    await runExecution(exec.id);
    await expect(requestExecution({ agentId: agent.id, trigger: "MANUAL" })).rejects.toMatchObject({ code: "DAILY_LIMIT" });
  });

  it("retries transient provider failures, then fails cleanly on the final attempt", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    const exec = await db.agentExecution.findFirstOrThrow({ where: { agentId: agent.id } });
    providerState.fail = true;
    await expect(runExecution(exec.id, { attempt: 1 })).rejects.toThrow(/503/);
    expect((await db.agentExecution.findUniqueOrThrow({ where: { id: exec.id } })).status).toBe("QUEUED");
    const r = await runExecution(exec.id, { attempt: 3, finalAttempt: true });
    expect(r).toHaveProperty("failed");
    expect((await db.agentExecution.findUniqueOrThrow({ where: { id: exec.id } })).status).toBe("FAILED");
    expect(await db.notification.count({ where: { userId: alice.userId, kind: "failure" } })).toBe(1);
    expect(await db.activityEvent.count({ where: { agentId: agent.id, type: "RESEARCH_FAILED" } })).toBe(1);
  });

  it("honours cancellation requests", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    const exec = await db.agentExecution.findFirstOrThrow({ where: { agentId: agent.id } });
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await runExecution(exec.id, { signal: ctrl.signal })).toEqual({ cancelled: true });
    expect((await db.agentExecution.findUniqueOrThrow({ where: { id: exec.id } })).status).toBe("CANCELLED");
  });

  it("pausing cancels queued runs and blocks new ones; resume restores scheduling", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    await transitionAgent(agent.id, "pause", alice.address);
    expect((await db.agentExecution.findFirstOrThrow({ where: { agentId: agent.id } })).status).toBe("CANCELLED");
    await expect(requestExecution({ agentId: agent.id, trigger: "MANUAL" })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
    expect((await db.agentSchedule.findUniqueOrThrow({ where: { agentId: agent.id } })).nextRunAt).toBeNull();
    await transitionAgent(agent.id, "resume", alice.address);
    expect((await db.agentSchedule.findUniqueOrThrow({ where: { agentId: agent.id } })).nextRunAt).not.toBeNull();
    await expect(transitionAgent(agent.id, "activate", alice.address)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("event monitoring triggers research only when thresholds are crossed", async () => {
    const agent = await createAgent(alice, { ...input(), activate: true });
    const first = await db.agentExecution.findFirstOrThrow({ where: { agentId: agent.id } });
    await runExecution(first.id);
    expect((await runMonitor(agent.id)).triggered).toBe(false);
    providerState.price = 1.1; // +7.8% vs snapshot, threshold 2%
    const r = await runMonitor(agent.id);
    expect(r.triggered).toBe(true);
    expect(await db.agentExecution.count({ where: { agentId: agent.id, trigger: "EVENT" } })).toBe(1);
    expect(await db.activityEvent.count({ where: { agentId: agent.id, type: "MONITOR_ALERT" } })).toBe(1);
    // Same hour bucket: no duplicate trigger.
    expect((await runMonitor(agent.id)).triggered).toBe(false);
  });
});

describe("job queue (postgres driver)", () => {
  it("claims each job once, backs off on failure and gives up after maxAttempts", async () => {
    await enqueue({ type: "stats", payload: {}, dedupeKey: "stats:test", maxAttempts: 2 });
    await enqueue({ type: "stats", payload: {}, dedupeKey: "stats:test", maxAttempts: 2 }); // deduped
    expect(await db.job.count()).toBe(1);
    const [job] = await claimJobs("w1", 5, 60_000);
    expect(job).toBeDefined();
    expect(await claimJobs("w2", 5, 60_000)).toHaveLength(0);
    expect(await failJob(job!, "boom", true)).toBe(false);
    const after = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(after.status).toBe("PENDING");
    expect(after.runAt.getTime()).toBeGreaterThan(Date.now());
    await db.job.update({ where: { id: job!.id }, data: { runAt: new Date(Date.now() - 1000) } });
    const [again] = await claimJobs("w1", 5, 60_000);
    expect(again!.attempts).toBe(2);
    expect(await failJob(again!, "boom", true)).toBe(true);
    expect((await db.job.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("FAILED");
  });

  it("reclaims jobs whose worker lock expired", async () => {
    await enqueue({ type: "stats", payload: {}, dedupeKey: "stats:lock" });
    await claimJobs("crashed-worker", 1, 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await claimJobs("w2", 1, 60_000)).toHaveLength(1);
  });
});

describe("marketplace", () => {
  it("lists active agents and supports search and category filters", async () => {
    await createAgent(alice, { ...input(), activate: true });
    await createAgent(alice, {
      ...input({
        identity: { name: "Golden Lens", ticker: "GLD", description: "Researches tokenized gold issuers and premiums.", specialization: "GOLD", objectives: ["Track gold tokens"] },
      }),
      activate: true,
    });
    expect((await listMarketplace({})).total).toBe(2);
    expect((await listMarketplace({ q: "golden" })).items.map((a) => a.name)).toEqual(["Golden Lens"]);
    expect((await listMarketplace({ q: "GLD" })).total).toBe(1);
    expect((await listMarketplace({ specialization: "TREASURIES" })).items.map((a) => a.name)).toEqual(["Integration Treasury Agent"]);
    expect((await listMarketplace({ tokenOnly: true })).total).toBe(0);
  });

  it("hides admin-disabled agents", async () => {
    const a = await createAgent(alice, { ...input(), activate: true });
    await db.agent.update({ where: { id: a.id }, data: { adminDisabled: true } });
    expect((await listMarketplace({})).total).toBe(0);
  });
});
