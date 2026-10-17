import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const { db } = await import("@/lib/db");
const { issueNonce, verifySiwe } = await import("@/lib/auth/siwe");

// A fresh random key per run — test-only, never persisted.
const account = privateKeyToAccount(generatePrivateKey());
const HOST = "localhost:3000";

const message = (nonce: string, over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) =>
  createSiweMessage({
    domain: HOST,
    address: account.address,
    uri: `http://${HOST}`,
    version: "1",
    chainId: 31337,
    nonce,
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 600_000),
    ...over,
  });

beforeEach(async () => {
  await db.authNonce.deleteMany();
});
afterAll(async () => {
  await db.authNonce.deleteMany();
  await db.$disconnect();
});

describe("Sign-In with Ethereum", () => {
  it("verifies a valid signature and consumes the nonce (replay protection)", async () => {
    const nonce = await issueNonce();
    const msg = message(nonce);
    const signature = await account.signMessage({ message: msg });
    const r = await verifySiwe({ message: msg, signature, expectedHost: HOST });
    expect(r.address).toBe(account.address);
    expect(r.chainId).toBe(31337);
    await expect(verifySiwe({ message: msg, signature, expectedHost: HOST })).rejects.toMatchObject({ status: 401 });
  });

  it("rejects messages issued for another domain", async () => {
    const nonce = await issueNonce();
    const msg = message(nonce, { domain: "evil.example" });
    const signature = await account.signMessage({ message: msg });
    await expect(verifySiwe({ message: msg, signature, expectedHost: HOST })).rejects.toMatchObject({ status: 401 });
  });

  it("rejects signatures from a different key", async () => {
    const nonce = await issueNonce();
    const msg = message(nonce);
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message: msg });
    await expect(verifySiwe({ message: msg, signature, expectedHost: HOST })).rejects.toThrow(/Signature verification failed|RPC|fetch/);
  });

  it("rejects unknown and expired nonces", async () => {
    const msg = message("abcdef1234567890");
    const signature = await account.signMessage({ message: msg });
    await expect(verifySiwe({ message: msg, signature, expectedHost: HOST })).rejects.toMatchObject({ status: 401 });

    const nonce = await issueNonce();
    await db.authNonce.update({ where: { nonce }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const msg2 = message(nonce);
    await expect(verifySiwe({ message: msg2, signature: await account.signMessage({ message: msg2 }), expectedHost: HOST })).rejects.toMatchObject({ status: 401 });
  });

  it("rejects unsupported chains", async () => {
    const nonce = await issueNonce();
    const msg = message(nonce, { chainId: 1 });
    await expect(verifySiwe({ message: msg, signature: await account.signMessage({ message: msg }), expectedHost: HOST })).rejects.toMatchObject({ status: 400 });
  });
});
