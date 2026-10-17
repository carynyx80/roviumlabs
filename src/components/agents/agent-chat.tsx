"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What are the major risks you found in your latest report?",
  "What changed in your latest analysis?",
  "Which assets are you currently monitoring?",
];

export function AgentChat({ agentId, agentName, hasResearch }: { agentId: string; agentName: string; hasResearch: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [llm, setLlm] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ conversationId: string | null; messages: Msg[]; llm: boolean }>(`/api/agents/${agentId}/chat`)
      .then((r) => {
        setConversationId(r.conversationId);
        setMessages(r.messages);
        setLlm(r.llm);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content };
    const botId = `a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: botId, role: "assistant", content: "" }]);
    try {
      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: content, conversationId: conversationId ?? undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `Request failed (${res.status})`);
      }
      const cid = res.headers.get("x-conversation-id");
      if (cid) setConversationId(cid);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        setMessages((m) => m.map((x) => (x.id === botId ? { ...x, content: x.content + chunk } : x)));
      }
    } catch (e) {
      setError(errorMessage(e));
      setMessages((m) => m.filter((x) => x.id !== botId || x.content));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-[640px] flex-col overflow-hidden">
      <div className="border-b border-border px-5 py-3.5">
        <p className="font-display font-semibold">Ask {agentName}</p>
        <p className="text-[12px] text-subtle">
          Answers are based on this agent&apos;s published research only. Public chat cannot change the agent or trigger actions.
        </p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5 scrollbar-thin" aria-live="polite">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading conversation…
          </p>
        )}
        {!loading && llm === false && (
          <Alert tone="info">AI chat is not configured on this deployment. You will receive the most relevant published findings instead of a generated answer.</Alert>
        )}
        {!loading && !hasResearch && <Alert tone="warning">This agent has not published research yet, so it has little to answer from.</Alert>}
        {!loading && messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Try asking:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-[10px] border border-border px-3 py-2 text-left text-sm text-silver hover:border-border-strong cursor-pointer">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-surface-2" : "bg-accent/15 text-accent")}>
              {m.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-[14px] px-4 py-2.5 text-sm leading-relaxed", m.role === "user" ? "bg-surface text-fg" : "border border-border bg-bg-2 text-silver")}>
              {m.content || <Loader2 className="size-4 animate-spin text-muted" />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <p className="px-5 pb-2 text-sm text-danger" role="alert">{error}</p>}
      <form
        className="flex gap-2 border-t border-border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask about this agent's research…"
          maxLength={800}
          className="min-h-[44px] resize-none"
          rows={1}
          aria-label="Your question"
        />
        <Button type="submit" variant="primary" disabled={busy || input.trim().length < 2} aria-label="Send">
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </Card>
  );
}
