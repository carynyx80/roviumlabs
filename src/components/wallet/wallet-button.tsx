"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, LayoutDashboard, LogOut, Settings, ShieldCheck, Wallet, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { useSession } from "@/components/providers";
import { api } from "@/lib/client/api";
import { chainById, enabledChains } from "@/lib/chain/chains";
import { shortAddress } from "@/lib/utils";

export function WalletButton({ full = false }: { full?: boolean }) {
  const { user, status, openConnect } = useSession();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const qc = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cls = full ? "w-full" : "";
  if (!mounted || status === "loading") {
    return (
      <Button variant="secondary" size="sm" disabled className={cls} aria-hidden>
        <Wallet /> Wallet
      </Button>
    );
  }

  // A session exists but the wallet now shows a different account → require re-auth.
  const mismatch = user && isConnected && address && address.toLowerCase() !== user.address;

  if (!user || mismatch) {
    return (
      <Button variant="primary" size="sm" onClick={openConnect} className={cls}>
        <Wallet /> {isConnected ? "Sign in" : "Connect wallet"}
      </Button>
    );
  }

  const chain = chainById(chainId);
  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    disconnect();
    await qc.invalidateQueries();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={isConnected && !chain ? "danger" : "secondary"} size="sm" className={full ? "w-full justify-between" : ""}>
          {isConnected && !chain ? <AlertTriangle /> : <span className="size-2 rounded-full bg-success" aria-hidden />}
          <span className="font-mono text-[13px]">{shortAddress(user.address)}</span>
          <ChevronDown className="text-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {isConnected ? (chain ? `Connected to ${chain.label}` : "Unsupported network") : "Signed in (wallet disconnected)"}
          {user.role === "ADMIN" && " · Admin"}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard /> Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        {user.role === "ADMIN" && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck /> Admin
            </Link>
          </DropdownMenuItem>
        )}
        {!isConnected && (
          <DropdownMenuItem onSelect={openConnect}>
            <Wallet /> Reconnect wallet
          </DropdownMenuItem>
        )}
        {isConnected &&
          enabledChains()
            .filter((c) => c.chain.id !== chainId)
            .map((c) => (
              <DropdownMenuItem key={c.chain.id} onSelect={() => switchChain({ chainId: c.chain.id })}>
                <Repeat /> Switch to {c.label}
              </DropdownMenuItem>
            ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
