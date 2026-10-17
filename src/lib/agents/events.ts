import type { ActivityType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient | typeof db;

/** Records a real platform event. Called only from code paths where the event actually happened. */
export async function recordEvent(
  tx: Tx,
  e: { type: ActivityType; agentId?: string; actor?: string; message: string; data?: Prisma.InputJsonValue },
) {
  return tx.activityEvent.create({
    data: { type: e.type, agentId: e.agentId, actor: e.actor, message: e.message.slice(0, 500), data: e.data },
  });
}

/**
 * In-app notification. External channels (email / Telegram / webhook) are dispatched
 * only for channels the user configured and verified; none are wired by default.
 */
export async function notify(
  tx: Tx,
  n: { userId: string; kind: string; title: string; body: string; link?: string },
) {
  return tx.notification.create({
    data: { userId: n.userId, kind: n.kind, title: n.title.slice(0, 140), body: n.body.slice(0, 600), link: n.link },
  });
}

export async function audit(
  tx: Tx,
  a: { actorId?: string; action: string; target?: string; data?: Prisma.InputJsonValue; ip?: string },
) {
  return tx.auditLog.create({ data: a });
}
