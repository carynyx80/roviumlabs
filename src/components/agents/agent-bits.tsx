import Link from "next/link";
import { Activity, Clock, Coins } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { RISK_LEVEL_LABEL, specializationShort } from "@/lib/agents/constants";
import { cn, timeAgo } from "@/lib/utils";
import type { AgentCardData } from "@/lib/server/queries";

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function AgentAvatar({
  name,
  imageId,
  size = 48,
  className,
}: {
  name: string;
  imageId?: string | null;
  size?: number;
  className?: string;
}) {
  if (imageId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/media/${imageId}`}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-[12px] object-cover ring-1 ring-white/10", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const h = hue(name);
  return (
    <div
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-[12px] font-display font-semibold text-fg ring-1 ring-white/10", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(145deg, hsl(${h} 30% 30%), hsl(${(h + 40) % 360} 25% 14%))`,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function StatusBadge({ status, adminDisabled }: { status: string; adminDisabled?: boolean }) {
  if (adminDisabled) return <Badge tone="danger">Suspended</Badge>;
  switch (status) {
    case "ACTIVE":
      return (
        <Badge tone="success">
          <span className="size-1.5 animate-pulse-soft rounded-full bg-success" /> Active
        </Badge>
      );
    case "PAUSED":
      return <Badge tone="warning">Paused</Badge>;
    case "DISABLED":
      return <Badge tone="danger">Disabled</Badge>;
    default:
      return <Badge>Draft</Badge>;
  }
}

export function ExecutionBadge({ status }: { status: string }) {
  const tone =
    status === "COMPLETED"
      ? "success"
      : status === "FAILED"
        ? "danger"
        : status === "CANCELLED"
          ? "neutral"
          : "accent";
  const live = ["QUEUED", "RESEARCHING", "ANALYZING", "PUBLISHING"].includes(status);
  return (
    <Badge tone={tone}>
      {live && <span className="size-1.5 animate-pulse-soft rounded-full bg-accent" />}
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function RiskBadge({ level, score }: { level: string; score?: number }) {
  const tone = level === "LOW" ? "success" : level === "MODERATE" ? "accent" : level === "ELEVATED" ? "warning" : "danger";
  return (
    <Badge tone={tone}>
      {RISK_LEVEL_LABEL[level] ?? level} risk{score != null && <span className="tabular-nums opacity-80">· {score}</span>}
    </Badge>
  );
}

export function AgentCard({ agent }: { agent: AgentCardData }) {
  const token = agent.tokenDeployments[0];
  const report = agent.reports[0];
  return (
    <Link
      href={`/agents/${agent.slug}`}
      className="group flex flex-col gap-4 rounded-[16px] border border-border surface-sheen p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong focus-visible:border-accent"
    >
      <div className="flex items-start gap-3.5">
        <AgentAvatar name={agent.name} imageId={agent.imageId} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-display text-[16px] font-semibold text-fg">{agent.name}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px] text-silver">${agent.ticker}</span>
            <span className="text-subtle">·</span>
            <span className="text-[12px] text-muted">{specializationShort(agent.specialization)}</span>
          </div>
        </div>
        <StatusBadge status={agent.status} />
      </div>
      <p className="line-clamp-2 min-h-[2.75rem] text-sm leading-relaxed text-muted">{agent.description}</p>
      {report ? (
        <div className="rounded-[10px] border border-border/70 bg-bg-2/60 px-3 py-2.5">
          <p className="line-clamp-1 text-[13px] text-silver">{report.title}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <RiskBadge level={report.riskLevel} score={report.riskScore} />
          </div>
        </div>
      ) : (
        <div className="rounded-[10px] border border-dashed border-border/70 px-3 py-2.5 text-[13px] text-subtle">
          No published research yet
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-[12px] text-subtle">
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" /> Last success {timeAgo(agent.lastSuccessAt)}
        </span>
        {token ? (
          <span className="flex items-center gap-1 text-accent">
            <Coins className="size-3.5" /> ${token.tokenSymbol}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Activity className="size-3.5" /> {agent.marketStats?.runs7d ?? 0} runs/7d
          </span>
        )}
      </div>
    </Link>
  );
}
