/**
 * Scriptable OpenAI-compatible server for automated tests. It speaks the real wire format
 * (/chat/completions with tools, JSON response_format and SSE streaming), so the production
 * client, retry logic and tool loop are exercised end to end — without a real model.
 * This is a test double; passing tests here do NOT demonstrate a live provider integration.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  model: string;
  messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }[];
  tools?: { function: { name: string } }[];
  tool_choice?: string;
  response_format?: { type: string; json_schema?: { name: string } };
  stream?: boolean;
  max_tokens?: number;
}

export type FakeReply =
  | { status: number; error: { code?: string; type?: string; message: string } }
  | { json: unknown; truncated?: boolean; usage?: { prompt_tokens: number; completion_tokens: number } }
  | { toolCalls: { name: string; args: unknown }[]; content?: string; usage?: { prompt_tokens: number; completion_tokens: number } }
  | { text: string; usage?: { prompt_tokens: number; completion_tokens: number } }
  | { stream: string[]; usage?: { prompt_tokens: number; completion_tokens: number } };

export type Handler = (req: FakeRequest, n: number) => FakeReply;

export async function startFakeLlm() {
  const requests: FakeRequest[] = [];
  let handler: Handler = () => ({ status: 500, error: { message: "no handler" } });
  let callId = 0;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as FakeRequest;
      requests.push(body);
      const reply = handler(body, requests.length);
      const usage = ("usage" in reply && reply.usage) || { prompt_tokens: 1000, completion_tokens: 200 };
      if ("status" in reply) {
        res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify({ error: reply.error }));
        return;
      }
      if ("stream" in reply) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const chunk of reply.stream) res.write(`data: ${JSON.stringify({ model: "fake-model", choices: [{ delta: { content: chunk } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: "fake-model", choices: [], usage })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      let message: Record<string, unknown>;
      if ("toolCalls" in reply) {
        message = {
          role: "assistant",
          content: reply.content ?? null,
          tool_calls: reply.toolCalls.map((t) => ({ id: `call_${++callId}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })),
        };
      } else if ("json" in reply) {
        const full = JSON.stringify(reply.json);
        message = { role: "assistant", content: reply.truncated ? full.slice(0, Math.floor(full.length / 2)) : full };
      } else {
        message = { role: "assistant", content: reply.text };
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ model: "fake-model", choices: [{ message, finish_reason: "json" in reply && reply.truncated ? "length" : "stop" }], usage }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    setHandler(h: Handler) {
      handler = h;
      requests.length = 0;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Helpers to identify request types. */
export const isPlan = (r: FakeRequest) => r.response_format?.json_schema?.name === "research_plan";
export const isReport = (r: FakeRequest) => r.response_format?.json_schema?.name === "rwa_research_report";
export const isToolTurn = (r: FakeRequest) => Array.isArray(r.tools);
export const toolResults = (r: FakeRequest) => r.messages.filter((m) => m.role === "tool");
