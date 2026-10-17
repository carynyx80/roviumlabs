import { notFound } from "next/navigation";
import { Coins, ExternalLink } from "lucide-react";
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { getPublicAgent } from "@/lib/server/queries";
import { anyChainById, explorerAddressUrl, explorerTxUrl } from "@/lib/chain/chains";
import { TOKEN_UTILITY_DISCLOSURE } from "@/lib/agents/constants";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AgentTokenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getPublicAgent(slug);
  if (!agent) notFound();
  const token = agent.tokenDeployments[0];

  if (!token) {
    return (
      <EmptyState
        icon={<Coins />}
        title="No token launched"
        description="This agent operates without a token. Token launch is optional and controlled by the creator."
      />
    );
  }
  const chain = anyChainById(token.chainId);
  const addrUrl = token.contractAddress ? explorerAddressUrl(token.chainId, token.contractAddress) : undefined;
  const txUrl = token.txHash ? explorerTxUrl(token.chainId, token.txHash) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>
            {token.tokenName} <span className="font-mono text-muted">${token.tokenSymbol}</span>
          </CardTitle>
          <p className="text-[13px] text-success">Deployment verified on-chain by RoviumPad</p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[12px] text-subtle">Network</dt>
              <dd className="mt-0.5">{chain?.label ?? `Chain ${token.chainId}`}{chain?.isTestnet ? " (test network)" : ""}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-subtle">Total supply (fixed)</dt>
              <dd className="mt-0.5 font-mono">{Number(token.totalSupply).toLocaleString()}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[12px] text-subtle">Contract address</dt>
              <dd className="mt-0.5 break-all font-mono text-[13px]">
                {token.contractAddress}
                {addrUrl && (
                  <a href={addrUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-accent hover:underline">
                    explorer <ExternalLink className="size-3" />
                  </a>
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[12px] text-subtle">Deployment transaction</dt>
              <dd className="mt-0.5 break-all font-mono text-[13px]">
                {token.txHash}
                {txUrl && (
                  <a href={txUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-accent hover:underline">
                    explorer <ExternalLink className="size-3" />
                  </a>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-subtle">Block</dt>
              <dd className="mt-0.5 font-mono">{token.blockNumber?.toString()}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-subtle">Verified</dt>
              <dd className="mt-0.5">{token.confirmedAt ? formatDateTime(token.confirmedAt) : "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <Alert tone="warning" title="Token utility">
          {TOKEN_UTILITY_DISCLOSURE}
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>Market data</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            No market data source is configured for this network, so RoviumPad does not show a price, volume or holder count.
            The standard launch mechanism does not create a liquidity pool.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
