"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { encodeDeployData, formatEther } from "viem";
import { toast } from "sonner";
import { CheckCircle2, Coins, ExternalLink, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui/primitives";
import { useSession } from "@/components/providers";
import { api, errorMessage } from "@/lib/client/api";
import { roviumAgentTokenAbi, roviumAgentTokenBytecode } from "@/lib/chain/artifacts/RoviumAgentToken";
import { LAUNCH_MECHANISMS } from "@/lib/chain/mechanisms";
import { TOKEN_UTILITY_DISCLOSURE } from "@/lib/agents/constants";
import { formatDateTime, shortAddress } from "@/lib/utils";
import type { AgentRecord } from "./settings-panel";
import type { ChainOption } from "./agent-manager";

interface Deployment {
  id: string;
  status: string;
  chainId: number;
  tokenName: string;
  tokenSymbol: string;
  totalSupply: string;
  contractAddress: string | null;
  txHash: string | null;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

type Phase = "form" | "preview" | "signing" | "confirming" | "done";

export function TokenPanel({ agent, chains }: { agent: AgentRecord; chains: ChainOption[] }) {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { user, openConnect } = useSession();
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  // Primary network first: Robinhood Chain mainnet when it is enabled on this deployment.
  const [chainId, setChainId] = useState<number>(chains.find((c) => !c.isTestnet)?.id ?? chains.find((c) => c.isTestnet && c.id !== 31337)?.id ?? chains[0]!.id);
  const [ackMainnet, setAckMainnet] = useState(false);
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });

  const [name, setName] = useState(sp.get("name") ?? agent.name);
  const [symbol, setSymbol] = useState(sp.get("symbol") ?? agent.ticker);
  const [supply, setSupply] = useState(sp.get("supply") ?? "1000000000");
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [estimate, setEstimate] = useState<{ gas: bigint; fee: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDeployment, setActiveDeployment] = useState<string | null>(null);
  const inFlight = useRef(false);

  const history = useQuery({
    queryKey: ["deployments", agent.id],
    queryFn: () => api<{ items: Deployment[] }>(`/api/agents/${agent.id}/token`),
  });
  const confirmed = history.data?.items.find((d) => d.status === "CONFIRMED");
  const pending = history.data?.items.find((d) => d.status === "SUBMITTED");
  const chainInfo = (id: number) => chains.find((c) => c.id === id);

  // Resume verification of a submitted deployment (e.g. after a reload).
  useEffect(() => {
    if (pending && !activeDeployment) {
      setActiveDeployment(pending.id);
      setPhase("confirming");
    }
  }, [pending, activeDeployment]);

  useEffect(() => {
    if (phase !== "confirming" || !activeDeployment) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ status: string; error?: string; pending?: boolean }>(`/api/agents/${agent.id}/token`, {
          method: "POST",
          body: { action: "verify", deploymentId: activeDeployment },
        });
        if (stop) return;
        if (r.status === "CONFIRMED") {
          setPhase("done");
          toast.success("Token verified on-chain");
          qc.invalidateQueries({ queryKey: ["deployments", agent.id] });
          return;
        }
        if (r.status === "FAILED") {
          setError(r.error ?? "Deployment failed verification");
          setPhase("form");
          qc.invalidateQueries({ queryKey: ["deployments", agent.id] });
          return;
        }
      } catch (e) {
        if (!stop) setError(`Verification check failed, retrying: ${errorMessage(e)}`);
      }
      if (!stop) setTimeout(tick, 4000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [phase, activeDeployment, agent.id, qc]);

  const onMainnet = chains.find((c) => c.id === chainId)?.isTestnet === false;
  const formValid = name.trim().length >= 3 && /^[A-Z0-9]{2,10}$/.test(symbol) && /^[1-9]\d{0,14}$/.test(supply) && ack && (!onMainnet || ackMainnet);
  const walletMatches = isConnected && address?.toLowerCase() === user?.address;
  const args = [name.trim(), symbol, BigInt(supply || "0"), (user?.address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`, agent.id, `${typeof window !== "undefined" ? window.location.origin : ""}/agents/${agent.slug}`] as const;

  const preview = async () => {
    setError(null);
    if (!publicClient || !address) return;
    try {
      if (walletChain !== chainId) await switchChainAsync({ chainId });
      // Simulation: eth_estimateGas executes the constructor; reverts surface here before any signature.
      const data = encodeDeployData({ abi: roviumAgentTokenAbi, bytecode: roviumAgentTokenBytecode, args });
      const [gas, gasPrice] = await Promise.all([publicClient.estimateGas({ account: address, data }), publicClient.getGasPrice()]);
      setEstimate({ gas, fee: gas * gasPrice });
      setPhase("preview");
    } catch (e) {
      setError(`Simulation failed: ${errorMessage(e).slice(0, 300)}`);
    }
  };

  const deploy = async () => {
    if (inFlight.current || !walletClient || !address) return;
    inFlight.current = true; // prevents double submission from rapid clicks
    setError(null);
    setPhase("signing");
    let deploymentId: string | null = null;
    try {
      const prep = await api<{ deploymentId: string; constructorArgs: { name: string; symbol: string; totalSupplyWholeTokens: string; creator: `0x${string}`; agentId: string; metadataURI: string } }>(
        `/api/agents/${agent.id}/token`,
        { method: "POST", body: { action: "prepare", mechanism: "standard-erc20", chainId, tokenName: name.trim(), tokenSymbol: symbol, totalSupply: supply, acknowledgeDisclosure: true, acknowledgeMainnet: onMainnet ? ackMainnet : undefined } },
      );
      deploymentId = prep.deploymentId;
      const a = prep.constructorArgs;
      const hash = await walletClient.deployContract({
        abi: roviumAgentTokenAbi,
        bytecode: roviumAgentTokenBytecode,
        args: [a.name, a.symbol, BigInt(a.totalSupplyWholeTokens), a.creator, a.agentId, a.metadataURI],
      });
      await api(`/api/agents/${agent.id}/token`, { method: "POST", body: { action: "submit", deploymentId, txHash: hash } });
      setActiveDeployment(deploymentId);
      setPhase("confirming");
      qc.invalidateQueries({ queryKey: ["deployments", agent.id] });
    } catch (e) {
      const msg = errorMessage(e);
      setError(/rejected|denied/i.test(msg) ? "Transaction was rejected in your wallet." : msg.slice(0, 300));
      setPhase("preview");
      if (deploymentId) {
        await api(`/api/agents/${agent.id}/token`, { method: "POST", body: { action: "abandon", deploymentId } }).catch(() => undefined);
      }
    } finally {
      inFlight.current = false;
    }
  };

  if (confirmed) {
    const c = chainInfo(confirmed.chainId);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" /> ${confirmed.tokenSymbol} is live
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted">
            {confirmed.tokenName} · {Number(confirmed.totalSupply).toLocaleString()} supply · {c?.label ?? `chain ${confirmed.chainId}`}
          </p>
          <p className="break-all font-mono text-[13px]">{confirmed.contractAddress}</p>
          {c?.explorerUrl && (
            <a href={`${c.explorerUrl}/address/${confirmed.contractAddress}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              View on explorer <ExternalLink className="size-3.5" />
            </a>
          )}
          <p className="text-[12px] text-subtle">Verified {confirmed.confirmedAt && formatDateTime(confirmed.confirmedAt)}</p>
        </CardContent>
      </Card>
    );
  }

  if (agent.status === "DRAFT") {
    return <Alert tone="info" title="Activate first">Token launch becomes available after the agent is activated. Agent creation and token deployment are separate steps.</Alert>;
  }
  if (agent.status === "DISABLED" || agent.adminDisabled) {
    return <Alert tone="warning">Disabled agents cannot launch tokens.</Alert>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="size-5 text-accent" /> Launch agent token
          </CardTitle>
          <p className="text-[13px] text-muted">Optional. Deployed from your own wallet; you hold the full supply.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {phase === "confirming" || phase === "done" ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm">
                {phase === "done" ? <CheckCircle2 className="size-4 text-success" /> : <Loader2 className="size-4 animate-spin text-accent" />}
                {phase === "done" ? "Deployment verified." : "Waiting for confirmation and on-chain verification…"}
              </p>
              {pending?.txHash && (
                <p className="break-all font-mono text-[12px] text-muted">
                  tx {pending.txHash}
                  {chainInfo(pending.chainId)?.explorerUrl && (
                    <a className="ml-2 text-accent hover:underline" href={`${chainInfo(pending.chainId)!.explorerUrl}/tx/${pending.txHash}`} target="_blank" rel="noopener noreferrer">
                      explorer
                    </a>
                  )}
                </p>
              )}
              <p className="text-[12px] text-subtle">The address is stored only after the receipt and the contract&apos;s on-chain state are verified.</p>
            </div>
          ) : (
            <>
              <Field label="Launch mechanism" htmlFor="mech">
                <Select id="mech" value="standard-erc20" onChange={() => undefined}>
                  {LAUNCH_MECHANISMS.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.enabled}>
                      {m.name}
                      {!m.enabled ? " — unavailable" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Token name" htmlFor="t-name">
                  <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={phase !== "form"} />
                </Field>
                <Field label="Symbol" htmlFor="t-sym">
                  <Input id="t-sym" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={10} className="font-mono" disabled={phase !== "form"} />
                </Field>
                <Field label="Total supply" htmlFor="t-sup" hint="Whole tokens">
                  <Input id="t-sup" inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value.replace(/\D/g, ""))} maxLength={15} className="font-mono" disabled={phase !== "form"} />
                </Field>
              </div>
              <Field label="Network" htmlFor="t-net">
                <Select id="t-net" value={chainId} onChange={(e) => { setChainId(Number(e.target.value)); setAckMainnet(false); }} disabled={phase !== "form"}>
                  {chains.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {c.isTestnet ? " (test network)" : " — mainnet, real ETH"}
                    </option>
                  ))}
                </Select>
              </Field>
              {onMainnet && (
                <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-danger/40 bg-danger/[0.05] p-4 text-[13px] text-silver">
                  <input type="checkbox" checked={ackMainnet} onChange={(e) => setAckMainnet(e.target.checked)} className="mt-0.5 size-4 accent-[#ff7a85]" disabled={phase !== "form"} />
                  <span>
                    <span className="font-medium text-danger">Robinhood Chain mainnet.</span> This deploys a real token using real ETH from your wallet
                    for gas. It is permanent and cannot be undone or deleted. The contract has not been independently audited.
                  </span>
                </label>
              )}
              <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-warning/30 bg-warning/[0.04] p-4 text-[13px] text-silver">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[#83b5ff]" disabled={phase !== "form"} />
                <span>{TOKEN_UTILITY_DISCLOSURE} I understand and accept this.</span>
              </label>

              {phase === "preview" && estimate && (
                <div className="rounded-[12px] border border-border bg-bg p-4 text-sm">
                  <p className="mb-3 font-medium">Transaction preview</p>
                  <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                    <dt className="text-subtle">Action</dt>
                    <dd>Deploy RoviumAgentToken</dd>
                    <dt className="text-subtle">From</dt>
                    <dd className="font-mono">{shortAddress(address)}</dd>
                    <dt className="text-subtle">Network</dt>
                    <dd>{chainInfo(chainId)?.label}</dd>
                    <dt className="text-subtle">Supply to you</dt>
                    <dd className="font-mono">
                      {Number(supply).toLocaleString()} {symbol}
                    </dd>
                    <dt className="text-subtle">Estimated gas</dt>
                    <dd className="font-mono">{estimate.gas.toLocaleString()}</dd>
                    <dt className="text-subtle">Estimated network fee</dt>
                    <dd className="font-mono">{Number(formatEther(estimate.fee)).toPrecision(4)} ETH</dd>
                    <dt className="text-subtle">RoviumPad fee</dt>
                    <dd>None</dd>
                  </dl>
                  <p className="mt-3 text-[12px] text-subtle">Simulation succeeded. Final fee depends on network conditions at signing.</p>
                </div>
              )}

              {!user ? null : !isConnected ? (
                <Button variant="primary" onClick={openConnect}>
                  Connect wallet
                </Button>
              ) : !walletMatches ? (
                <Alert tone="warning">Your wallet is connected as {shortAddress(address)}, but you are signed in as {shortAddress(user.address)}. Switch accounts in your wallet to deploy.</Alert>
              ) : phase === "form" ? (
                <Button variant="primary" onClick={preview} disabled={!formValid}>
                  Simulate & preview
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setPhase("form")} disabled={phase === "signing"}>
                    Edit
                  </Button>
                  <Button variant="primary" onClick={deploy} loading={phase === "signing"}>
                    <Rocket /> Confirm in wallet
                  </Button>
                </div>
              )}
            </>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-[13px] text-muted">
              <li>RoviumPad validates the configuration and records a prepared deployment.</li>
              <li>Your wallet simulates and signs the contract deployment. RoviumPad never holds keys.</li>
              <li>The server waits for the receipt, checks the sender, the bytecode and the contract state.</li>
              <li>Only then is the contract address stored and linked to the agent.</li>
            </ol>
            <p className="mt-4 text-[12px] text-subtle">{LAUNCH_MECHANISMS[0]!.feeDisclosure}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Other mechanisms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13px] text-muted">
            {LAUNCH_MECHANISMS.filter((m) => !m.enabled).map((m) => (
              <div key={m.id}>
                <p className="flex items-center gap-2 text-silver">
                  {m.name} <Badge>Unavailable</Badge>
                </p>
                <p className="mt-1">{m.unavailableReason}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        {history.data && history.data.items.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Deployment history</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-[13px]">
                {history.data.items.map((d) => (
                  <li key={d.id} className="flex justify-between gap-3">
                    <span className="text-silver">${d.tokenSymbol} · {chainInfo(d.chainId)?.label ?? d.chainId}</span>
                    <span className="text-subtle" title={d.error ?? undefined}>
                      {d.status.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
