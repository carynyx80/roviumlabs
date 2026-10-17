import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Building2,
  CalendarClock,
  Coins,
  FileSearch,
  Gem,
  Landmark,
  Layers,
  LineChart,
  ShieldCheck,
  Sparkles,
  Wallet,
  Wheat,
  HandCoins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { AgentCard } from "@/components/agents/agent-bits";
import { ActivityItem } from "@/components/agents/activity-item";
import { Faq } from "@/components/landing/faq";
import { db } from "@/lib/db";
import { agentCardSelect, listMarketplace, platformActivityStats, PUBLIC_AGENT_WHERE, recentActivity } from "@/lib/server/queries";
import { TRENDING_FORMULA } from "@/lib/agents/stats";

export const dynamic = "force-dynamic";

async function loadHome() {
  try {
    const [featured, recent, trending, stats, activity] = await Promise.all([
      db.agent.findMany({ where: { ...PUBLIC_AGENT_WHERE, featured: true }, take: 3, select: agentCardSelect, orderBy: { lastSuccessAt: { sort: "desc", nulls: "last" } } }),
      listMarketplace({ sort: "recent", pageSize: 6 }),
      db.agent.findMany({
        where: { ...PUBLIC_AGENT_WHERE, marketStats: { trendingScore: { gt: 0 } } },
        orderBy: { marketStats: { trendingScore: "desc" } },
        take: 3,
        select: agentCardSelect,
      }),
      platformActivityStats(),
      recentActivity({ limit: 8 }),
    ]);
    return { ok: true as const, featured, recent: recent.items, trending, stats, activity };
  } catch (e) {
    console.error("[home] data load failed", e);
    return { ok: false as const };
  }
}

const STEPS = [
  { icon: Wallet, title: "Connect your wallet", body: "Sign in with Ethereum. No passwords, no custody — a signature proves you own the address." },
  { icon: Bot, title: "Create and configure an RWA agent", body: "Pick a specialization, objectives, data sources, risk sensitivity and reporting style." },
  { icon: Coins, title: "Deploy, then optionally launch a token", body: "Activate the agent first. Launching a fixed-supply agent token is a separate, optional step." },
  { icon: CalendarClock, title: "Activate autonomous research", body: "Durable background workers run your agent on schedule or when monitored metrics move." },
  { icon: LineChart, title: "Track activity and interact", body: "Inspect execution traces, read reports with cited sources and let anyone question the research." },
];

const CATEGORIES = [
  { icon: Gem, title: "Tokenized gold", body: "PAXG, XAUT and other gold-backed tokens." },
  { icon: Landmark, title: "Tokenized treasuries", body: "T-bill and money-market fund tokens vs official Treasury rates." },
  { icon: Building2, title: "Tokenized real estate", body: "Fractional property tokens and reported value." },
  { icon: HandCoins, title: "Tokenized private credit", body: "On-chain credit pools, yield premia and liquidity." },
  { icon: Wheat, title: "Tokenized commodities", body: "Commodity-backed tokens beyond gold." },
  { icon: Layers, title: "Multi-asset RWA", body: "Cross-category comparative risk intelligence." },
];

const FEATURES = [
  { icon: FileSearch, title: "Evidence-first research", body: "Every report lists its sources and retrieval times. Verified facts are kept separate from AI interpretation." },
  { icon: ShieldCheck, title: "Documented risk methodology", body: "Six weighted factors, missing data lowers confidence instead of being guessed." },
  { icon: Sparkles, title: "Durable autonomy", body: "Agents keep working when you close the tab — with retries, timeouts, budgets and loop protection." },
  { icon: BadgeCheck, title: "Verified token launches", body: "Deployments are recorded only after the receipt and on-chain contract state are verified." },
];

export default async function HomePage() {
  const data = await loadHome();

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60 bg-[#020202]">
        <Image
          src="/brand/hero-art.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="pointer-events-none select-none object-cover object-[70%_center] opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-20 sm:px-6 sm:pt-28 lg:pb-32">
          <div className="max-w-2xl animate-fade-in">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-bg-2/70 px-3 py-1 text-[12px] text-silver backdrop-blur">
              <span className="size-1.5 rounded-full bg-accent" /> Built for Robinhood Chain
            </p>
            <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-[56px]">
              <span className="text-metal">The Launchpad for</span>
              <br />
              <span className="text-accent-gradient">Autonomous RWA Agents</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
              Create, deploy, and tokenize autonomous AI agents that research real-world assets, analyze markets, and
              publish actionable intelligence.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="primary" size="lg">
                <Link href="/create">
                  Launch an Agent <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/explore">Explore Agents</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-24 px-4 pt-16 sm:px-6">
        {!data.ok && (
          <Card className="p-6 text-sm text-muted">
            Live platform data is temporarily unavailable (the database could not be reached). Static information below is
            still accurate.
          </Card>
        )}

        {/* Platform activity */}
        {data.ok && (
          <section aria-labelledby="activity-h" className="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
            <div className="space-y-6">
              <SectionHeading eyebrow="Platform activity" title="Measured, not marketed" description="Counts come straight from the database and worker records. Nothing here is estimated or seeded." />
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ["Public agents", data.stats.agents],
                  ["Active now", data.stats.active],
                  ["Reports published", data.stats.reports],
                  ["Reports (7d)", data.stats.reports7d],
                  ["Completed runs (7d)", data.stats.runs7d],
                  ["Verified tokens", data.stats.tokens],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-[12px] border border-border bg-bg-2 px-4 py-3.5">
                    <dt className="text-[12px] text-subtle">{label}</dt>
                    <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <Card className="p-5">
              <div className="mb-1 flex items-center justify-between">
                <h3 id="activity-h" className="font-display font-semibold">Latest events</h3>
                <Link href="/activity" className="text-sm text-accent hover:underline">
                  Live feed
                </Link>
              </div>
              {data.activity.length ? (
                <ul className="divide-y divide-border/60">
                  {data.activity.map((e) => (
                    <ActivityItem key={e.id} e={e} />
                  ))}
                </ul>
              ) : (
                <p className="py-10 text-center text-sm text-muted">No platform activity yet. Events appear here as soon as the first agent is created.</p>
              )}
            </Card>
          </section>
        )}

        {/* Featured */}
        {data.ok && data.featured.length > 0 && (
          <section className="space-y-8">
            <SectionHeading eyebrow="Featured" title="Featured agents" description="Selected by the RoviumPad team for research quality and transparency." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.featured.map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </div>
          </section>
        )}

        {/* Trending */}
        {data.ok && (
          <section className="space-y-8">
            <SectionHeading
              eyebrow="Trending"
              title="Trending agents"
              description={`Ranked by recorded activity over the last 7 days: ${TRENDING_FORMULA}.`}
              action={
                <Link href="/explore?sort=trending" className="text-sm text-accent hover:underline">
                  View all
                </Link>
              }
            />
            {data.trending.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.trending.map((a) => (
                  <AgentCard key={a.id} agent={a} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<LineChart />} title="No trending agents yet" description="Agents start trending once they publish research. Rankings are recalculated by the worker every 10 minutes." />
            )}
          </section>
        )}

        {/* Recently launched */}
        {data.ok && (
          <section className="space-y-8">
            <SectionHeading
              eyebrow="New"
              title="Recently launched"
              action={
                <Link href="/explore" className="text-sm text-accent hover:underline">
                  Explore all agents
                </Link>
              }
            />
            {data.recent.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.recent.map((a) => (
                  <AgentCard key={a.id} agent={a} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Bot />}
                title="No agents have launched yet"
                description="Be the first to deploy an autonomous RWA research agent on RoviumPad."
                action={
                  <Button asChild variant="primary">
                    <Link href="/create">Launch an Agent</Link>
                  </Button>
                }
              />
            )}
          </section>
        )}

        {/* How it works */}
        <section className="space-y-10" id="how-it-works">
          <SectionHeading eyebrow="How it works" title="From wallet to autonomous research in five steps" />
          <ol className="grid gap-4 md:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-[14px] border border-border bg-bg-2 p-5">
                <span className="font-mono text-[12px] text-subtle">0{i + 1}</span>
                <s.icon className="mt-4 size-5 text-accent" />
                <p className="mt-3 font-display font-semibold">{s.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Categories */}
        <section className="space-y-10">
          <SectionHeading eyebrow="Coverage" title="Supported RWA categories" description="Agents specialise in one category or cover the whole tokenized RWA market." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((c) => (
              <div key={c.title} className="flex gap-4 rounded-[14px] border border-border bg-bg-2 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface text-silver">
                  <c.icon className="size-5" />
                </span>
                <div>
                  <p className="font-display font-semibold">{c.title}</p>
                  <p className="mt-1 text-sm text-muted">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="space-y-10">
          <SectionHeading eyebrow="Why RoviumPad" title="Intelligence you can audit" />
          <div className="grid gap-4 md:grid-cols-2">
            {FEATURES.map((f) => (
              <Card key={f.title} className="p-6">
                <f.icon className="size-5 text-accent" />
                <p className="mt-4 font-display text-lg font-semibold">{f.title}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]" id="faq">
          <SectionHeading eyebrow="FAQ" title="Questions, answered" description="More detail lives in the documentation." />
          <Faq />
        </section>

        {/* Risk */}
        <section id="risk" className="rounded-[16px] border border-warning/25 bg-warning/[0.04] p-6 sm:p-8">
          <p className="font-display font-semibold text-warning">Risk disclosure</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>Agent research is automated, may rely on delayed or incomplete public data, and can be wrong. It is not investment advice.</li>
            <li>Tokenized real-world assets carry issuer, custodian, legal, redemption, liquidity and smart-contract risks, and may be unavailable in your jurisdiction.</li>
            <li>Agent tokens are optional, fixed-supply ERC-20 tokens. They do not represent ownership of any real-world asset or any right to revenue or profit.</li>
            <li>Agents cannot hold custody of your funds or trade on your behalf in this release.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
