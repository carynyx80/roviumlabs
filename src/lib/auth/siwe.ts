import "server-only";
import { randomBytes } from "node:crypto";
import { getAddress, verifyMessage, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { db } from "@/lib/db";
import { chainById } from "@/lib/chain/chains";
import { publicClientFor } from "@/lib/chain/server";
import { badRequest, unauthorized } from "@/lib/server/http";

export const NONCE_TTL_MS = 10 * 60_000;

export async function issueNonce(): Promise<string> {
  // SIWE nonces must be alphanumeric and at least 8 characters.
  const nonce = randomBytes(16).toString("hex");
  await db.authNonce.create({ data: { nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) } });
  return nonce;
}

export interface VerifiedSiwe {
  address: `0x${string}`;
  chainId: number;
}

/**
 * Verifies an EIP-4361 message:
 *  - domain/uri must match this deployment (phishing protection)
 *  - chain must be enabled
 *  - nonce must exist, be unexpired and unused; it is consumed atomically (replay protection)
 *  - signature is checked with ECDSA, falling back to ERC-1271/6492 for smart accounts
 */
export async function verifySiwe(input: {
  message: string;
  signature: Hex;
  expectedHost: string;
}): Promise<VerifiedSiwe> {
  const fields = parseSiweMessage(input.message);
  if (!fields.address || !fields.nonce || !fields.chainId || !fields.domain || !fields.uri) {
    throw badRequest("Malformed sign-in message");
  }
  if (!chainById(fields.chainId)) throw badRequest("Please switch to a supported network before signing in");

  const valid = validateSiweMessage({
    message: fields,
    domain: input.expectedHost,
    time: new Date(),
  });
  if (!valid) throw unauthorized("Sign-in message is expired or was issued for another domain");
  if (fields.issuedAt && Date.now() - fields.issuedAt.getTime() > NONCE_TTL_MS) {
    throw unauthorized("Sign-in message is too old, please try again");
  }

  // Consume the nonce exactly once.
  const consumed = await db.authNonce.updateMany({
    where: { nonce: fields.nonce, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) throw unauthorized("Sign-in nonce is invalid or has already been used");

  const address = getAddress(fields.address);
  let ok = false;
  try {
    ok = await verifyMessage({ address, message: input.message, signature: input.signature });
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      ok = await publicClientFor(fields.chainId).verifyMessage({
        address,
        message: input.message,
        signature: input.signature,
      });
    } catch {
      ok = false;
    }
  }
  if (!ok) throw unauthorized("Signature verification failed");
  return { address, chainId: fields.chainId };
}
