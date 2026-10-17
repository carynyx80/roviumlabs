import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Coins,
  FileText,
  Pause,
  Play,
  PlusCircle,
  Power,
  Search,
  XCircle,
} from "lucide-react";
import { AgentAvatar } from "./agent-bits";
import { timeAgo } from "@/lib/utils";

const ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  AGENT_CREATED: { icon: PlusCircle, color: "text-silver", label: "Agent created" },
  AGENT_ACTIVATED: { icon: Power, color: "text-success", label: "Agent activated" },
  AGENT_PAUSED: { icon: Pause, color: "text-warning", label: "Agent paused" },
  AGENT_RESUMED: { icon: Play, color: "text-success", label: "Agent resumed" },
  AGENT_DISABLED: { icon: XCircle, color: "text-danger", label: "Agent disabled" },
  RESEARCH_STARTED: { icon: Search, color: "text-accent", label: "Research started" },
  RESEARCH_COMPLETED: { icon: CheckCircle2, color: "text-success", label: "Research completed" },
  RESEARCH_FAILED: { icon: AlertTriangle, color: "text-danger", label: "Research failed" },
  REPORT_PUBLISHED: { icon: FileText, color: "text-accent", label: "Report published" },
  MONITOR_ALERT: { icon: BellRing, color: "text-warning", label: "Monitoring alert" },
  TOKEN_SUBMITTED: { icon: Coins, color: "text-silver", label: "Token deployment submitted" },
  TOKEN_CONFIRMED: { icon: Coins, color: "text-success", label: "Token deployment confirmed" },
  TOKEN_FAILED: { icon: Coins, color: "text-danger", label: "Token deployment failed" },
};

export interface ActivityRow {
  id: string;
  type: string;
  message: string;
  createdAt: string | Date;
  agent: { slug: string; name: string; imageId: string | null } | null;
}

export function ActivityItem({ e, showAgent = true }: { e: ActivityRow; showAgent?: boolean }) {
  const meta = ICONS[e.type] ?? { icon: Activity, color: "text-muted", label: e.type };
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-3 py-3.5">
      {showAgent && e.agent ? (
        <Link href={`/agents/${e.agent.slug}`} className="shrink-0" aria-label={e.agent.name}>
          <AgentAvatar name={e.agent.name} imageId={e.agent.imageId} size={36} />
        </Link>
      ) : (
        <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface ${meta.color}`}>
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-silver">
          {showAgent && e.agent ? (
            <Link href={`/agents/${e.agent.slug}`} className="font-medium text-fg hover:underline">
              {e.agent.name}
            </Link>
          ) : null}
          {showAgent && e.agent ? " · " : ""}
          <span className={meta.color}>{meta.label}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{e.message}</p>
      </div>
      <time className="shrink-0 text-[12px] text-subtle" dateTime={new Date(e.createdAt).toISOString()}>
        {timeAgo(e.createdAt)}
      </time>
    </li>
  );
}
