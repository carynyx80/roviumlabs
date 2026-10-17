"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, injected } from "wagmi";
import { Toaster } from "sonner";
import { enabledChains } from "@/lib/chain/chains";
import { api } from "@/lib/client/api";
import { ConnectDialog } from "@/components/wallet/connect-dialog";

const chains = enabledChains().map((c) => c.chain) as unknown as readonly [
  import("viem").Chain,
  ...import("viem").Chain[],
];

/**
 * Wallet connectivity uses wagmi directly. Browser wallets are discovered via EIP-6963
 * (MetaMask, Rabby, Coinbase Wallet extension, Brave, OKX, Trust…); the generic
 * `injected` connector covers legacy wallets and mobile in-app browsers.
 */
export const wagmiConfig = createConfig({
  chains,
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: Object.fromEntries(chains.map((c) => [c.id, http(c.rpcUrls.default.http[0])])),
  ssr: true,
});

export interface SessionUser {
  id: string;
  address: string;
  role: "USER" | "ADMIN";
  displayName: string | null;
  chainId: number;
}

type Status = "loading" | "authenticated" | "unauthenticated";

const SessionContext = React.createContext<{
  user: SessionUser | null;
  status: Status;
  refresh: () => Promise<unknown>;
  openConnect: () => void;
}>({ user: null, status: "loading", refresh: async () => undefined, openConnect: () => undefined });

export const useSession = () => React.useContext(SessionContext);

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ user: SessionUser | null }>("/api/auth/session"),
    staleTime: 60_000,
  });
  const status: Status = session.isLoading ? "loading" : session.data?.user ? "authenticated" : "unauthenticated";
  const value = React.useMemo(
    () => ({
      user: session.data?.user ?? null,
      status,
      refresh: () => session.refetch(),
      openConnect: () => setOpen(true),
    }),
    [session, status],
  );
  return (
    <SessionContext.Provider value={value}>
      {children}
      <ConnectDialog open={open} onOpenChange={setOpen} />
    </SessionContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ style: { background: "#111722", border: "1px solid #273242", color: "#F5F7FA" } }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
