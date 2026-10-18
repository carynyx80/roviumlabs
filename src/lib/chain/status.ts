import "server-only";
import { encodeDeployData, formatEther, formatGwei } from "viem";
import { enabledChains } from "./chains";
import { publicClientFor } from "./server";
import { roviumAgentTokenAbi, roviumAgentTokenBytecode } from "./artifacts/RoviumAgentToken";

/**
 * Live, read-only network checks. Nothing is signed or sent: the token deployment is a dry run
 * (eth_estimateGas), which executes the constructor on the live chain and fails if the contract
 * could not be deployed there.
 */
export interface NetworkStatus {
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

const DRY_RUN_FROM = "0x000000000000000000000000000000000000dEaD" as const;
let cache: { at: number; value: NetworkStatus[] } | null = null;

async function check(info: ReturnType<typeof enabledChains>[number]): Promise<NetworkStatus> {
  const base = {
    key: info.key,
    label: info.label,
    chainId: info.chain.id,
    isTestnet: info.isTestnet,
    explorerUrl: info.explorerUrl ?? null,
    checkedAt: new Date().toISOString(),
  };
  const started = Date.now();
  try {
    const client = publicClientFor(info.chain.id);
    const [chainId, block, gasPrice] = await Promise.all([client.getChainId(), client.getBlock(), client.getGasPrice()]);
    let deploySimulation: NetworkStatus["deploySimulation"];
    try {
      const data = encodeDeployData({
        abi: roviumAgentTokenAbi,
        bytecode: roviumAgentTokenBytecode,
        args: ["Status Check", "CHK", 1_000_000n, DRY_RUN_FROM, "status-check", "https://roviumpad.app"],
      });
      const gas = await client.estimateGas({ account: DRY_RUN_FROM, data });
      deploySimulation = { ok: true, gas: gas.toString(), estimatedCostEth: formatEther(gas * gasPrice) };
    } catch (e) {
      deploySimulation = { ok: false, error: (e as Error).message.split("\n")[0]!.slice(0, 200) };
    }
    return {
      ...base,
      ok: chainId === info.chain.id && deploySimulation.ok,
      chainIdMatches: chainId === info.chain.id,
      latestBlock: block.number.toString(),
      blockAgeSec: Math.max(0, Math.round(Date.now() / 1000 - Number(block.timestamp))),
      gasPriceGwei: formatGwei(gasPrice),
      deploySimulation,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return { ...base, ok: false, error: (e as Error).message.split("\n")[0]!.slice(0, 200), latencyMs: Date.now() - started };
  }
}

/** Status of every enabled network, cached for 30 seconds to protect public RPCs. */
export async function networkStatus(): Promise<NetworkStatus[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = await Promise.all(enabledChains().map((c) => check(c)));
  cache = { at: Date.now(), value };
  return value;
}
