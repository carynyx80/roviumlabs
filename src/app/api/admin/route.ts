import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { audit, notify, recordEvent } from "@/lib/agents/events";
import { badRequest, clientIp, notFound, ok, readJson, route } from "@/lib/server/http";

const body = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("agent"),
    id: z.string().cuid(),
    action: z.enum(["disable", "enable", "feature", "unfeature"]),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({ target: z.literal("abuse-report"), id: z.string().cuid(), action: z.enum(["resolve", "dismiss"]) }),
  z.object({ target: z.literal("report"), id: z.string().cuid(), action: z.enum(["hide", "unhide"]) }),
  z.object({ target: z.literal("user"), id: z.string().cuid(), action: z.enum(["ban", "unban"]) }),
]);

/** Moderation actions. Admin-only; every action is written to the audit log. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const input = await readJson(req, body);
  const ip = clientIp(req);

  await db.$transaction(async (tx) => {
    if (input.target === "agent") {
      const agent = await tx.agent.findUnique({ where: { id: input.id } });
      if (!agent) throw notFound("Agent not found");
      if (input.action === "disable") {
        if (!input.reason) throw badRequest("A reason is required to disable an agent");
        await tx.agent.update({ where: { id: agent.id }, data: { adminDisabled: true, disabledReason: input.reason, featured: false } });
        await tx.agentSchedule.updateMany({ where: { agentId: agent.id }, data: { nextRunAt: null, nextMonitorAt: null } });
        await tx.agentExecution.updateMany({ where: { agentId: agent.id, status: "QUEUED" }, data: { status: "CANCELLED", finishedAt: new Date(), error: "Agent disabled by administrator" } });
        await tx.agentExecution.updateMany({ where: { agentId: agent.id, status: { in: ["RESEARCHING", "ANALYZING", "PUBLISHING"] } }, data: { cancelRequested: true } });
        await recordEvent(tx, { type: "AGENT_DISABLED", agentId: agent.id, actor: "admin", message: `${agent.name} was suspended by moderators` });
        await notify(tx, { userId: agent.ownerId, kind: "failure", title: `${agent.name} was suspended`, body: input.reason, link: `/dashboard/agents/${agent.id}` });
      } else if (input.action === "enable") {
        await tx.agent.update({ where: { id: agent.id }, data: { adminDisabled: false, disabledReason: null } });
        await notify(tx, { userId: agent.ownerId, kind: "status", title: `${agent.name} was reinstated`, body: "You can resume the agent from your dashboard." });
      } else {
        await tx.agent.update({ where: { id: agent.id }, data: { featured: input.action === "feature" } });
      }
    } else if (input.target === "abuse-report") {
      await tx.agentAbuseReport.update({
        where: { id: input.id },
        data: { status: input.action === "resolve" ? "RESOLVED" : "DISMISSED", resolvedAt: new Date() },
      });
    } else if (input.target === "report") {
      await tx.researchReport.update({ where: { id: input.id }, data: { hidden: input.action === "hide" } });
    } else {
      if (input.id === admin.userId) throw badRequest("You cannot ban yourself");
      await tx.user.update({ where: { id: input.id }, data: { banned: input.action === "ban" } });
      if (input.action === "ban") await tx.session.updateMany({ where: { userId: input.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(tx, {
      actorId: admin.userId,
      action: `admin.${input.target}.${input.action}`,
      target: input.id,
      data: "reason" in input && input.reason ? { reason: input.reason } : undefined,
      ip,
    });
  });
  return ok({ ok: true });
});
