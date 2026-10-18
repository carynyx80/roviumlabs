/**
 * Read-only check of Robinhood Chain mainnet (chain id 4663). Sends no transactions and
 * spends nothing: it reads chain state and dry-runs (eth_estimateGas) a RoviumAgentToken
 * deployment to prove the contract can be deployed on mainnet.
 *
 * Usage: npx tsx scripts/check-mainnet.mts [rpcUrl]
 */
import { createPublicClient, encodeDeployData, formatEther, formatGwei, http } from "viem";
import { roviumAgentTokenAbi, roviumAgentTokenBytecode } from "../src/lib/chain/artifacts/RoviumAgentToken";

const rpc = process.argv[2] ?? process.env.RPC_URL_ROBINHOOD_MAINNET ?? "https://rpc.mainnet.chain.robinhood.com";
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000 }) });
// Any address works for a dry run; this is the creator the simulated token would mint to.
const creator = "0x000000000000000000000000000000000000dEaD";

const chainId = await client.getChainId();
const block = await client.getBlock();
const gasPrice = await client.getGasPrice();
const data = encodeDeployData({
  abi: roviumAgentTokenAbi,
  bytecode: roviumAgentTokenBytecode,
  args: ["Mainnet Check Token", "CHK", 1_000_000n, creator, "mainnet-check", "https://roviumpad.app"],
});
const gas = await client.estimateGas({ account: creator, data });

console.log(
  JSON.stringify(
    {
      rpc,
      chainId,
      expectedChainId: 4663,
      chainIdOk: chainId === 4663,
      latestBlock: block.number.toString(),
      blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
      gasPriceGwei: formatGwei(gasPrice),
      tokenDeployGasEstimate: gas.toString(),
      estimatedDeployCostEth: formatEther(gas * gasPrice),
    },
    null,
    2,
  ),
);
