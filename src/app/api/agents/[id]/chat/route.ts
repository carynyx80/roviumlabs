import { z } from "zod";
import { db } from "@/lib/db";
import { env, llmConfigured } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";
import { answerQuestion } from "@/lib/agents/chat";
import { PUBLIC_AGENT_WHERE } from "@/lib/server/queries";
import { visitorId } from "@/lib/server/visitor";
import { clientIp, forbidden, notFound, ok, readJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  conversationId: z.string().cuid().optional(),
  message: z.string().trim().min(2).max(800),
});

async function owner() {
  const session = await getSession();
  return session ? { userId: session.userId, visitor: null as string | null } : { userId: null as string | null, visitor: await visitorId(true) };
}

async function loadConversation(agentId: string, conversationId: string | undefined, who: { userId: string | null; visitor: string | null }) {
  if (!conversationId) return null;
  const c = await db.chatConversation.findUnique({ where: { id: conversationId } });
  if (!c || c.agentId !== agentId) throw notFound("Conversation not found");
  const mine = who.userId ? c.userId === who.userId : c.visitorId === who.visitor;
  if (!mine) throw forbidden("This conversation belongs to someone else");
  return c;
}

export const GET = route<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const who = await owner();
  const conversationId = new URL(req.url).searchParams.get("conversationId") ?? undefined;
  const conv = conversationId
    ? await loadConversation(id, conversationId, who)
    : await db.chatConversation.findFirst({
        where: { agentId: id, ...(who.userId ? { userId: who.userId } : { visitorId: who.visitor }) },
        orderBy: { updatedAt: "desc" },
      });
  if (!conv) return ok({ conversationId: null, messages: [], llm: llmConfigured() });
  const messages = await db.chatMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "asc" }, take: 100 });
  return ok({ conversationId: conv.id, messages, llm: llmConfigured() });
});

export const POST = route<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const agent = await db.agent.findFirst({ where: { id, ...PUBLIC_AGENT_WHERE } });
  if (!agent) throw notFound("Agent not found");
  const who = await owner();
  const e = env();
  await rateLimit(`chat:${who.userId ?? who.visitor}:${clientIp(req)}`, e.CHAT_MESSAGES_PER_HOUR, 3600);
  await rateLimit(`chat-agent:${id}`, 300, 3600); // per-agent ceiling against coordinated abuse
  const input = await readJson(req, body);

  const conv =
    (await loadConversation(id, input.conversationId, who)) ??
    (await db.chatConversation.create({ data: { agentId: id, userId: who.userId, visitorId: who.visitor } }));

  const history = await db.chatMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" }, take: 6 });
  await db.chatMessage.create({ data: { conversationId: conv.id, role: "user", content: input.message } });
  await db.chatConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
  const config = await db.agentConfig.findUnique({ where: { agentId: id }, select: { dailySpendLimitUsd: true, dailyTokenBudget: true } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of answerQuestion({
          agent,
          config,
          question: input.message,
          history: history.reverse(),
          userId: who.userId,
          signal: req.signal,
          onComplete: async (r) => {
            await db.chatMessage
              .create({ data: { conversationId: conv.id, role: "assistant", content: r.text.slice(0, 8000), citations: { mode: r.mode, sources: r.citations, invalid: r.invalidCitations } as unknown as Prisma.InputJsonValue } })
              .catch(() => undefined);
            if (r.usage) {
              await db.usageRecord
                .create({ data: { agentId: id, userId: who.userId, kind: "llm_chat", model: r.usage.model, promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens, costUsd: r.usage.costUsd } })
                .catch(() => undefined);
            }
          },
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[chat] failed", err);
        controller.enqueue(encoder.encode("\n\n[Something went wrong answering this question. Please try again.]"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-conversation-id": conv.id } });
});

