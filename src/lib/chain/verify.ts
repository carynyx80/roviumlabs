import "server-only";
import { getAddress, type Hex, type PublicClient } from "viem";
import { roviumAgentTokenAbi, roviumAgentTokenBytecode } from "./artifacts/RoviumAgentToken";

export interface ExpectedDeployment {
  creator: string; // lowercase address
  tokenName: string;
  tokenSymbol: string;
  totalSupply: string; // whole tokens
  agentId: string;
}

export type VerifyResult =
  | { state: "pending" }
  | { state: "failed"; reason: string; blockNumber?: bigint }
  | { state: "confirmed"; contractAddress: `0x${string}`; blockNumber: bigint; gasUsed: bigint };

/**
 * Verifies a token deployment on-chain. A deployment is confirmed only if:
 *  1. the transaction is mined with status success and created a contract
 *  2. it was sent by the creator's signed-in wallet
 *  3. its init code is the RoviumAgentToken bytecode (not an arbitrary contract)
 *  4. the deployed contract's state (name, symbol, supply, agentId, creator) matches the prepared config
 */
export async function verifyDeployment(client: PublicClient, hash: Hex, expected: ExpectedDeployment): Promise<VerifyResult> {
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return { state: "pending" };
  if (receipt.status !== "success") return { state: "failed", reason: "Transaction reverted", blockNumber: receipt.blockNumber };
  if (!receipt.contractAddress) return { state: "failed", reason: "Transaction did not create a contract", blockNumber: receipt.blockNumber };

  const tx = await client.getTransaction({ hash });
  if (tx.from.toLowerCase() !== expected.creator) {
    return { state: "failed", reason: "Transaction was not sent by the agent creator's wallet", blockNumber: receipt.blockNumber };
  }
  if (!tx.input.toLowerCase().startsWith(roviumAgentTokenBytecode.toLowerCase())) {
    return { state: "failed", reason: "Deployed bytecode is not the RoviumAgentToken contract", blockNumber: receipt.blockNumber };
  }

  const address = getAddress(receipt.contractAddress);
  const read = <T>(functionName: string) =>
    client.readContract({ address, abi: roviumAgentTokenAbi, functionName: functionName as never }) as Promise<T>;
  const [name, symbol, supply, decimals, agentId, creator] = await Promise.all([
    read<string>("name"),
    read<string>("symbol"),
    read<bigint>("totalSupply"),
    read<number>("decimals"),
    read<string>("agentId"),
    read<string>("creator"),
  ]);
  const expectedSupply = BigInt(expected.totalSupply) * 10n ** BigInt(decimals);
  const mismatches = [
    name !== expected.tokenName && "name",
    symbol !== expected.tokenSymbol && "symbol",
    supply !== expectedSupply && "totalSupply",
    agentId !== expected.agentId && "agentId",
    creator.toLowerCase() !== expected.creator && "creator",
  ].filter(Boolean);
  if (mismatches.length) {
    return { state: "failed", reason: `On-chain state does not match the prepared launch (${mismatches.join(", ")})`, blockNumber: receipt.blockNumber };
  }
  return { state: "confirmed", contractAddress: address, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}
