import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { env } from "@/lib/env";
import { chainById } from "./chains";

const clients = new Map<number, PublicClient>();

/** Server-side public client. Uses RPC_URL_* overrides (which may include API keys). */
export function publicClientFor(chainId: number): PublicClient {
  const info = chainById(chainId);
  if (!info) throw new Error(`Chain ${chainId} is not enabled on this deployment`);
  const existing = clients.get(chainId);
  if (existing) return existing;
  const e = env();
  const override =
    info.key === "localhost"
      ? e.RPC_URL_LOCALHOST
      : info.key === "robinhood-testnet"
        ? e.RPC_URL_ROBINHOOD_TESTNET
        : e.RPC_URL_ROBINHOOD_MAINNET;
  const client = createPublicClient({
    chain: info.chain,
    transport: http(override ?? info.chain.rpcUrls.default.http[0], { timeout: 20_000, retryCount: 2 }),
  }) as PublicClient;
  clients.set(chainId, client);
  return client;
}
