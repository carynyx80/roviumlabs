import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { tokenLaunchSchema } from "@/lib/agents/validation";
import { TOKEN_UTILITY_DISCLOSURE } from "@/lib/agents/constants";
import { recordEvent, notify } from "@/lib/agents/events";
import { requireOwnedAgent } from "@/lib/server/agents";
import { chainById, isMainnet } from "@/lib/chain/chains";
import { enabledMechanism } from "@/lib/chain/mechanisms";
import { publicClientFor } from "@/lib/chain/server";
import { verifyDeployment } from "@/lib/chain/verify";
import { ApiError, badRequest, conflict, forbidden, notFound, ok, readJson, route, serialize } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }).merge(tokenLaunchSchema),
  z.object({ action: z.literal("submit"), deploymentId: z.string().cuid(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  z.object({ action: z.literal("verify"), deploymentId: z.string().cuid() }),
  z.object({ action: z.literal("abandon"), deploymentId: z.string().cuid() }),
]);

/** Deployment history for the creator. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await requireOwnedAgent(session, id);
  const items = await db.tokenDeployment.findMany({ where: { agentId: id }, orderBy: { createdAt: "desc" }, include: { transactions: true } });
  return ok(serialize({ items }));
});

export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const agent = await requireOwnedAgent(session, id);
  if (agent.ownerId !== session.userId) throw forbidden("Only the creator can launch the agent's token");
  await rateLimit(`token:${session.userId}`, 30, 3600);
  const input = await readJson(req, body);

  if (input.action === "prepare") {
    if (!enabledMechanism(input.mechanism)) throw badRequest("This launch mechanism is not available");
    if (agent.adminDisabled || agent.status === "DISABLED") throw forbidden("Disabled agents cannot launch tokens");
    if (agent.status === "DRAFT") throw badRequest("Activate the agent before launching its token");
    const chain = chainById(input.chainId);
    if (!chain) throw badRequest("This network is not enabled for token launches");
    if (isMainnet(input.chainId) && input.acknowledgeMainnet !== true) {
      throw badRequest("Mainnet launches spend real ETH and cannot be undone. Confirm the mainnet acknowledgement to continue.");
    }
    // The wallet may switch networks after sign-in; verification only requires the deploying address to match.
    const existing = await db.tokenDeployment.findMany({ where: { agentId: id, status: { in: ["CONFIRMED", "SUBMITTED", "PREPARED"] } } });
    if (existing.some((d) => d.status === "CONFIRMED")) throw conflict("This agent already has a verified token");
    if (existing.some((d) => d.status === "SUBMITTED")) throw conflict("A deployment is already awaiting confirmation");
    // Abandoned preparations are superseded so a fresh one can be created.
    await db.tokenDeployment.updateMany({ where: { agentId: id, status: "PREPARED" }, data: { status: "FAILED", error: "Superseded by a new launch preparation" } });

    const deployment = await db.tokenDeployment.create({
      data: {
        agentId: id,
        creatorId: session.userId,
        mechanism: input.mechanism,
        chainId: input.chainId,
        tokenName: input.tokenName,
        tokenSymbol: input.tokenSymbol,
        totalSupply: input.totalSupply,
        imageId: agent.imageId,
      },
    });
    return ok({
      deploymentId: deployment.id,
      chainId: input.chainId,
      constructorArgs: {
        name: input.tokenName,
        symbol: input.tokenSymbol,
        totalSupplyWholeTokens: input.totalSupply,
        creator: session.address,
        agentId: agent.id,
        metadataURI: `${env().APP_URL}/agents/${agent.slug}`,
      },
      disclosure: TOKEN_UTILITY_DISCLOSURE,
    });
  }

  const deployment = await db.tokenDeployment.findUnique({ where: { id: input.deploymentId } });
  if (!deployment || deployment.agentId !== id) throw notFound("Deployment not found");

  if (input.action === "abandon") {
    if (deployment.status !== "PREPARED") throw badRequest("Only unsent deployments can be abandoned");
    await db.tokenDeployment.update({ where: { id: deployment.id }, data: { status: "FAILED", error: "Cancelled before submission" } });
    return ok({ status: "FAILED" });
  }

  if (input.action === "submit") {
    if (deployment.status !== "PREPARED") throw conflict("This deployment was already submitted");
    const hash = input.txHash.toLowerCase();
    const updated = await db.$transaction(async (tx) => {
      const res = await tx.tokenDeployment.updateMany({
        where: { id: deployment.id, status: "PREPARED" },
        data: { status: "SUBMITTED", txHash: hash },
      });
      if (res.count !== 1) throw conflict("This deployment was already submitted");
      await tx.blockchainTransaction.create({
        data: { deploymentId: deployment.id, chainId: deployment.chainId, hash, from: session.address, kind: "token_deploy", status: "pending" },
      });
      await recordEvent(tx, {
        type: "TOKEN_SUBMITTED",
        agentId: id,
        actor: session.address,
        message: `${agent.name} token $${deployment.tokenSymbol} deployment submitted`,
        data: { chainId: deployment.chainId, txHash: hash },
      });
      return tx.tokenDeployment.findUniqueOrThrow({ where: { id: deployment.id } });
    });
    return ok(serialize({ status: updated.status, txHash: updated.txHash }));
  }

  // verify
  if (deployment.status === "CONFIRMED") return ok(serialize({ status: "CONFIRMED", contractAddress: deployment.contractAddress }));
  if (deployment.status !== "SUBMITTED" || !deployment.txHash) throw badRequest("Nothing to verify for this deployment");
  let result;
  try {
    result = await verifyDeployment(publicClientFor(deployment.chainId), deployment.txHash as `0x${string}`, {
      creator: session.address,
      tokenName: deployment.tokenName,
      tokenSymbol: deployment.tokenSymbol,
      totalSupply: deployment.totalSupply,
      agentId: agent.id,
    });
  } catch (e) {
    throw new ApiError(502, "RPC_ERROR", `Could not reach the network RPC: ${(e as Error).message.slice(0, 200)}`);
  }
  if (result.state === "pending") return ok({ status: "SUBMITTED", pending: true });

  if (result.state === "failed") {
    await db.$transaction(async (tx) => {
      await tx.tokenDeployment.update({ where: { id: deployment.id }, data: { status: "FAILED", error: result.reason, blockNumber: result.blockNumber } });
      await tx.blockchainTransaction.updateMany({ where: { deploymentId: deployment.id }, data: { status: "reverted", blockNumber: result.blockNumber } });
      await recordEvent(tx, { type: "TOKEN_FAILED", agentId: id, actor: session.address, message: `${agent.name} token deployment failed: ${result.reason}` });
    });
    return ok({ status: "FAILED", error: result.reason });
  }

  const confirmed = await db.$transaction(async (tx) => {
    const d = await tx.tokenDeployment.update({
      where: { id: deployment.id },
      data: { status: "CONFIRMED", contractAddress: result.contractAddress.toLowerCase(), blockNumber: result.blockNumber, confirmedAt: new Date(), error: null },
    });
    await tx.blockchainTransaction.updateMany({
      where: { deploymentId: deployment.id },
      data: { status: "success", blockNumber: result.blockNumber, gasUsed: result.gasUsed.toString() },
    });
    await recordEvent(tx, {
      type: "TOKEN_CONFIRMED",
      agentId: id,
      actor: session.address,
      message: `${agent.name} token $${d.tokenSymbol} verified on-chain`,
      data: { chainId: d.chainId, contractAddress: d.contractAddress, txHash: d.txHash },
    });
    await notify(tx, { userId: agent.ownerId, kind: "token", title: `$${d.tokenSymbol} deployment confirmed`, body: `Contract ${d.contractAddress}`, link: `/agents/${agent.slug}/token` });
    return d;
  });
  return ok(serialize({ status: "CONFIRMED", contractAddress: confirmed.contractAddress, blockNumber: confirmed.blockNumber }));
});
