import { afterEach, describe, expect, it } from "vitest";
import { chainById, enabledChains, explorerAddressUrl, explorerTxUrl, isMainnet } from "@/lib/chain/chains";
import { tokenLaunchSchema } from "@/lib/agents/validation";

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, NEXT_PUBLIC_CHAINS: env.NEXT_PUBLIC_CHAINS, NEXT_PUBLIC_ENABLE_MAINNET: env.NEXT_PUBLIC_ENABLE_MAINNET };
afterEach(() => Object.assign(env, saved));

const keys = () => enabledChains().map((c) => c.key);

describe("network configuration", () => {
  it("defaults production to Robinhood Chain mainnet first, then testnet", () => {
    env.NODE_ENV = "production";
    delete env.NEXT_PUBLIC_CHAINS;
    delete env.NEXT_PUBLIC_ENABLE_MAINNET;
    expect(keys()).toEqual(["robinhood-mainnet", "robinhood-testnet"]);
    expect(enabledChains()[0]!.chain.id).toBe(4663);
  });

  it("defaults development to the local chain and testnet", () => {
    env.NODE_ENV = "development";
    delete env.NEXT_PUBLIC_CHAINS;
    expect(keys()).toEqual(["localhost", "robinhood-testnet"]);
  });

  it("the kill switch removes mainnet everywhere", () => {
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_CHAINS = "robinhood-mainnet,robinhood-testnet";
    env.NEXT_PUBLIC_ENABLE_MAINNET = "false";
    expect(keys()).toEqual(["robinhood-testnet"]);
    expect(chainById(4663)).toBeUndefined(); // sign-in and token launches on mainnet are rejected
  });

  it("never returns an empty list and ignores unknown or duplicate keys", () => {
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_CHAINS = "robinhood-mainnet,ethereum,robinhood-mainnet";
    env.NEXT_PUBLIC_ENABLE_MAINNET = "";
    expect(keys()).toEqual(["robinhood-mainnet"]);
    env.NEXT_PUBLIC_CHAINS = "nonsense";
    expect(keys()).toEqual(["robinhood-testnet"]);
  });

  it("identifies mainnet and builds Blockscout links", () => {
    expect(isMainnet(4663)).toBe(true);
    expect(isMainnet(46630)).toBe(false);
    expect(isMainnet(31337)).toBe(false);
    expect(explorerTxUrl(4663, "0xabc")).toBe("https://robinhoodchain.blockscout.com/tx/0xabc");
    expect(explorerAddressUrl(46630, "0xdef")).toBe("https://explorer.testnet.chain.robinhood.com/address/0xdef");
  });

  it("accepts an explicit mainnet acknowledgement on token launches", () => {
    const base = { mechanism: "standard-erc20", chainId: 4663, tokenName: "Gold Watch", tokenSymbol: "GW", totalSupply: "1000000", acknowledgeDisclosure: true };
    expect(tokenLaunchSchema.parse({ ...base, acknowledgeMainnet: true }).acknowledgeMainnet).toBe(true);
    expect(tokenLaunchSchema.parse(base).acknowledgeMainnet).toBeUndefined(); // the route rejects this for mainnet
  });
});
