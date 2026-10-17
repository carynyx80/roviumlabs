/**
 * Contract tests on an in-process Hardhat network (no external node). Uses the same compiled
 * artifact the web app deploys, and the same server-side verifier that confirms launches.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, custom, getAddress, type Hex, type PublicClient, type WalletClient } from "viem";
import { hardhat } from "viem/chains";
import { createRequire } from "node:module";
import { roviumAgentTokenAbi, roviumAgentTokenBytecode } from "@/lib/chain/artifacts/RoviumAgentToken";
import { verifyDeployment } from "@/lib/chain/verify";

const require = createRequire(import.meta.url);
let pub: PublicClient;
let wallet: WalletClient;
let creator: `0x${string}`;
let other: `0x${string}`;

beforeAll(async () => {
  process.env.HARDHAT_CONFIG = "hardhat.config.cjs";
  const hre = require("hardhat");
  const provider = hre.network.provider;
  const transport = custom({ request: (args: { method: string; params?: unknown[] }) => provider.request(args) });
  pub = createPublicClient({ chain: hardhat, transport }) as PublicClient;
  wallet = createWalletClient({ chain: hardhat, transport });
  [creator, other] = (await wallet.getAddresses()) as [`0x${string}`, `0x${string}`];
});

async function deploy(args: { name?: string; symbol?: string; supply?: bigint; creator?: `0x${string}`; agentId?: string; from?: `0x${string}` } = {}) {
  const hash = await wallet.deployContract({
    account: args.from ?? creator,
    chain: hardhat,
    abi: roviumAgentTokenAbi,
    bytecode: roviumAgentTokenBytecode,
    args: [args.name ?? "Agent Token", args.symbol ?? "AGT", args.supply ?? 1_000_000n, args.creator ?? creator, args.agentId ?? "cagent123", "https://roviumpad.test/agents/x"],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, address: receipt.contractAddress! };
}

const read = <T>(address: `0x${string}`, functionName: string, args: unknown[] = []) =>
  pub.readContract({ address, abi: roviumAgentTokenAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

describe("RoviumAgentToken", () => {
  it("mints the fixed supply to the creator and stores the agent reference", async () => {
    const { address } = await deploy({ supply: 1_000n });
    expect(await read<bigint>(address, "totalSupply")).toBe(1_000n * 10n ** 18n);
    expect(await read<bigint>(address, "balanceOf", [creator])).toBe(1_000n * 10n ** 18n);
    expect(await read<string>(address, "agentId")).toBe("cagent123");
    expect(getAddress(await read<string>(address, "creator"))).toBe(getAddress(creator));
    expect(await read<string>(address, "ROVIUM_TOKEN_VERSION")).toBe("1");
  });

  it("exposes no privileged functions (no owner, mint, pause or upgrade)", () => {
    const fns = roviumAgentTokenAbi.filter((x) => x.type === "function").map((x) => (x as { name: string }).name);
    for (const banned of ["mint", "owner", "transferOwnership", "pause", "upgradeTo", "burnFrom", "setFee", "blacklist"]) {
      expect(fns).not.toContain(banned);
    }
  });

  it("reverts on zero supply, zero creator and empty agent id", async () => {
    await expect(deploy({ supply: 0n })).rejects.toThrow();
    await expect(deploy({ creator: "0x0000000000000000000000000000000000000000" })).rejects.toThrow();
    await expect(deploy({ agentId: "" })).rejects.toThrow();
    await expect(deploy({ supply: 10n ** 16n })).rejects.toThrow();
  });

  it("transfers like a standard ERC-20", async () => {
    const { address } = await deploy();
    await pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({ account: creator, chain: hardhat, address, abi: roviumAgentTokenAbi, functionName: "transfer", args: [other, 5n] }),
    });
    expect(await read<bigint>(address, "balanceOf", [other])).toBe(5n);
  });
});

describe("server-side deployment verification", () => {
  const expected = (over: Partial<Parameters<typeof verifyDeployment>[2]> = {}) => ({
    creator: creator.toLowerCase(),
    tokenName: "Agent Token",
    tokenSymbol: "AGT",
    totalSupply: "1000000",
    agentId: "cagent123",
    ...over,
  });

  it("confirms a matching deployment", async () => {
    const { hash, address } = await deploy();
    const r = await verifyDeployment(pub, hash, expected());
    expect(r).toMatchObject({ state: "confirmed", contractAddress: getAddress(address) });
  });

  it("rejects deployments sent by someone other than the creator", async () => {
    const { hash } = await deploy({ from: other, creator: other });
    const r = await verifyDeployment(pub, hash, expected());
    expect(r).toMatchObject({ state: "failed" });
    expect((r as { reason: string }).reason).toMatch(/creator/);
  });

  it("rejects on-chain state that differs from the prepared launch", async () => {
    const { hash } = await deploy({ symbol: "XXX" });
    const r = await verifyDeployment(pub, hash, expected());
    expect((r as { reason: string }).reason).toMatch(/symbol/);
  });

  it("rejects transactions that are not RoviumAgentToken deployments", async () => {
    const hash = await wallet.sendTransaction({ account: creator, chain: hardhat, to: other, value: 1n });
    await pub.waitForTransactionReceipt({ hash });
    const r = await verifyDeployment(pub, hash, expected());
    expect(r).toMatchObject({ state: "failed" });
  });

  it("reports unknown transactions as pending", async () => {
    const r = await verifyDeployment(pub, ("0x" + "11".repeat(32)) as Hex, expected());
    expect(r).toEqual({ state: "pending" });
  });
});
