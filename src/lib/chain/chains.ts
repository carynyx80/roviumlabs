import { defineChain, type Chain } from "viem";

/**
 * Chain registry. Values for Robinhood Chain come from the official documentation:
 * https://docs.robinhood.com/chain/connecting (testnet chain id 46630, mainnet 4663).
 * Public RPCs are rate limited; production deployments should configure a dedicated
 * provider through RPC_URL_* (server) and NEXT_PUBLIC_RPC_URL_* (browser) variables.
 *
 * This file is imported by both client and server code. It must never contain secrets.
 */

export type ChainKey = "localhost" | "robinhood-testnet" | "robinhood-mainnet";

export interface ChainInfo {
  key: ChainKey;
  chain: Chain;
  label: string;
  isTestnet: boolean;
  explorerUrl?: string;
}

export const localhost = defineChain({
  id: 31337,
  name: "Local Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [(process.env.NEXT_PUBLIC_RPC_URL_LOCALHOST || "http://127.0.0.1:8545")] },
  },
  testnet: true,
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [(process.env.NEXT_PUBLIC_RPC_URL_ROBINHOOD_TESTNET || "https://rpc.testnet.chain.robinhood.com")],
    },
  },
  blockExplorers: {
    default: { name: "Robinhood Testnet Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [(process.env.NEXT_PUBLIC_RPC_URL_ROBINHOOD_MAINNET || "https://rpc.mainnet.chain.robinhood.com")],
    },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const ALL: Record<ChainKey, ChainInfo> = {
  localhost: { key: "localhost", chain: localhost, label: "Local Hardhat", isTestnet: true },
  "robinhood-testnet": {
    key: "robinhood-testnet",
    chain: robinhoodTestnet,
    label: "Robinhood Chain Testnet",
    isTestnet: true,
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  },
  "robinhood-mainnet": {
    key: "robinhood-mainnet",
    chain: robinhoodMainnet,
    label: "Robinhood Chain",
    isTestnet: false,
    explorerUrl: "https://robinhoodchain.blockscout.com",
  },
};

/**
 * Enabled chains are controlled by NEXT_PUBLIC_CHAINS (comma separated keys).
 * Mainnet additionally requires NEXT_PUBLIC_ENABLE_MAINNET=true so it can never be
 * switched on by accident.
 */
export function enabledChains(): ChainInfo[] {
  const raw = process.env.NEXT_PUBLIC_CHAINS || "localhost,robinhood-testnet";
  const mainnetAllowed = process.env.NEXT_PUBLIC_ENABLE_MAINNET === "true";
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is ChainKey => k in ALL)
    .filter((k) => k !== "robinhood-mainnet" || mainnetAllowed);
  return keys.length ? keys.map((k) => ALL[k]) : [ALL.localhost];
}

export function chainById(id: number): ChainInfo | undefined {
  return enabledChains().find((c) => c.chain.id === id);
}

export function anyChainById(id: number): ChainInfo | undefined {
  return Object.values(ALL).find((c) => c.chain.id === id);
}

export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  const c = anyChainById(chainId);
  return c?.explorerUrl ? `${c.explorerUrl}/tx/${hash}` : undefined;
}

export function explorerAddressUrl(chainId: number, address: string): string | undefined {
  const c = anyChainById(chainId);
  return c?.explorerUrl ? `${c.explorerUrl}/address/${address}` : undefined;
}
