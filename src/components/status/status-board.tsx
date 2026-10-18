"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, Stat } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/utils";

interface Network {
  key: string;
  label: string;
  chainId: number;
  isTestnet: boolean;
  explorerUrl: string | null;
  ok: boolean;
  chainIdMatches?: boolean;
  latestBlock?: string;
  blockAgeSec?: number;
  gasPriceGwei?: string;
  deploySimulation?: { ok: boolean; gas?: string; estimatedCostEth?: string; error?: string };
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}
interface StatusResponse {
  platform: { database: boolean; workersOnline: number; queue: string; llmConfigured: boolean };
  networks: Network[];
  time: string;
}

const Ok = ({ ok }: { ok: boolean }) => (ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />);

export function StatusBoard() {
  const q = useQuery({ queryKey: ["status"], queryFn: () => api<StatusResponse>("/api/status"), refetchInterval: 30_000 });

  if (q.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.isError || !q.data) return <Alert tone="danger" title="Status unavailable">{errorMessage(q.error)}</Alert>;
  const { platform, networks } = q.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-subtle">Checked {timeAgo(q.data.time)}</p>
        <Button variant="ghost" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {networks.map((n) => (
          <Card key={n.key} className={n.isTestnet ? "" : "border-accent/30"}>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Ok ok={n.ok} /> {n.label}
                </CardTitle>
                <p className="mt-1 text-[13px] text-muted">Chain ID {n.chainId}</p>
              </div>
              <Badge tone={n.isTestnet ? "neutral" : "accent"}>{n.isTestnet ? "Testnet" : "Mainnet"}</Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              {n.error ? (
                <Alert tone="danger" title="Network unreachable">{n.error}</Alert>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Stat label="Latest block" value={<span className="font-mono text-base">{Number(n.latestBlock).toLocaleString()}</span>} hint={`${n.blockAgeSec}s ago`} />
                    <Stat label="Gas price" value={<span className="font-mono text-base">{Number(n.gasPriceGwei).toPrecision(3)}</span>} hint="gwei" />
                    <Stat label="Chain ID check" value={<span className="text-base">{n.chainIdMatches ? "Match" : "Mismatch"}</span>} />
                    <Stat label="RPC latency" value={<span className="font-mono text-base">{n.latencyMs}</span>} hint="ms" />
                  </div>
                  <div className="rounded-[12px] border border-border bg-bg p-4 text-sm">
                    <p className="flex items-center gap-2 font-medium">
                      <Ok ok={Boolean(n.deploySimulation?.ok)} /> Agent token deployment (dry run)
                    </p>
                    {n.deploySimulation?.ok ? (
                      <p className="mt-1 text-[13px] text-muted">
                        RoviumAgentToken deploys successfully: {Number(n.deploySimulation.gas).toLocaleString()} gas ≈{" "}
                        <span className="font-mono text-silver">{Number(n.deploySimulation.estimatedCostEth).toPrecision(3)} ETH</span> at current gas price.
                      </p>
                    ) : (
                      <p className="mt-1 text-[13px] text-danger">{n.deploySimulation?.error}</p>
                    )}
                  </div>
                </>
              )}
              {n.explorerUrl && (
                <a href={n.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                  Block explorer <ExternalLink className="size-3" />
                </a>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Database" value={<span className="flex items-center gap-2 text-base"><Ok ok={platform.database} /> {platform.database ? "Connected" : "Unavailable"}</span>} />
          <Stat
            label="Agent workers"
            value={<span className="flex items-center gap-2 text-base"><Ok ok={platform.workersOnline > 0} /> {platform.workersOnline} online</span>}
            hint={platform.workersOnline ? `queue: ${platform.queue}` : "autonomous research is paused"}
          />
          <Stat label="AI provider" value={<span className="flex items-center gap-2 text-base"><Ok ok={platform.llmConfigured} /> {platform.llmConfigured ? "Configured" : "Not configured"}</span>} />
          <Stat label="Queue" value={<span className="text-base">{platform.queue}</span>} />
        </CardContent>
      </Card>
    </div>
  );
}
