"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useSignMessage, useSwitchChain, useDisconnect } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { createSiweMessage } from "viem/siwe";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { chainById, enabledChains } from "@/lib/chain/chains";
import { shortAddress } from "@/lib/utils";

/**
 * Two-step wallet flow:
 *  1. connect an EVM wallet (EIP-6963 discovered or generic injected)
 *  2. sign an EIP-4361 (SIWE) message with a server-issued single-use nonce
 * The signature is gasless; RoviumPad never requests seed phrases or private keys.
 */
export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setDone(false);
    }
  }, [open]);

  const supported = Boolean(chainById(chainId));
  const target = enabledChains()[0]!;

  // Deduplicate: prefer EIP-6963 announced wallets over the generic injected fallback.
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const list = announced.length ? announced : connectors;

  const signIn = async () => {
    if (!address) return;
    setError(null);
    setSigning(true);
    try {
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce", { method: "POST" });
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to RoviumPad. This request will not trigger a transaction or cost any gas.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signMessageAsync({ message });
      await api("/api/auth/verify", { method: "POST", body: { message, signature } });
      await qc.invalidateQueries();
      setDone(true);
      setTimeout(() => onOpenChange(false), 700);
    } catch (e) {
      const msg = errorMessage(e);
      setError(/rejected|denied/i.test(msg) ? "Signature request was rejected in your wallet." : msg);
    } finally {
      setSigning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isConnected ? "Sign in to RoviumPad" : "Connect a wallet"} description={isConnected ? "Prove you own this address with a free signature." : "Choose an EVM wallet installed in your browser."} className="max-w-md">
        {!isConnected && (
          <div className="space-y-2">
            {list.length === 0 && (
              <Alert tone="warning" title="No browser wallet detected">
                Install an EVM wallet extension such as MetaMask or Rabby, or open this page in your mobile wallet&apos;s in-app browser.
              </Alert>
            )}
            {list.map((c) => (
              <button
                key={c.uid}
                type="button"
                disabled={connecting}
                onClick={async () => {
                  setError(null);
                  try {
                    await connectAsync({ connector: c });
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
                className="flex w-full items-center gap-3 rounded-[12px] border border-border bg-bg px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-60 cursor-pointer"
              >
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="size-7 rounded-md" />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-md bg-surface-2">
                    <Wallet className="size-4 text-muted" />
                  </span>
                )}
                <span className="flex-1 text-sm font-medium">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                {connecting && <Loader2 className="size-4 animate-spin text-muted" />}
              </button>
            ))}
          </div>
        )}

        {isConnected && address && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3">
              <div>
                <p className="font-mono text-sm">{shortAddress(address, 6)}</p>
                <p className="text-[12px] text-subtle">via {connector?.name ?? "wallet"}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => disconnect()}>
                Change
              </Button>
            </div>
            {!supported ? (
              <>
                <Alert tone="warning" title="Unsupported network">
                  Switch to {enabledChains().map((c) => c.label).join(" or ")} to continue.
                </Alert>
                <div className="flex flex-wrap gap-2">
                  {enabledChains().map((c) => (
                    <Button
                      key={c.chain.id}
                      variant={c.chain.id === target.chain.id ? "primary" : "secondary"}
                      loading={switching}
                      onClick={async () => {
                        try {
                          await switchChainAsync({ chainId: c.chain.id });
                        } catch (e) {
                          setError(errorMessage(e));
                        }
                      }}
                    >
                      Switch to {c.label}
                    </Button>
                  ))}
                </div>
              </>
            ) : done ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" /> Signed in
              </p>
            ) : (
              <>
                <ul className="space-y-1.5 text-[13px] text-muted">
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" /> Free, gasless signature — no transaction is sent.
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" /> Single-use nonce, expires in 10 minutes.
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" /> RoviumPad will never ask for your seed phrase.
                  </li>
                </ul>
                <Button variant="primary" className="w-full" onClick={signIn} loading={signing}>
                  Sign message
                </Button>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 flex items-start gap-2 text-sm text-danger" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
