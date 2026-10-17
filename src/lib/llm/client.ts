import type { ZodTypeAny, output } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env, llmConfigured } from "@/lib/env";

/**
 * Provider-agnostic client for any OpenAI-compatible /chat/completions API
 * (OpenAI, OpenRouter, Groq, Together, Anthropic's OpenAI-compatible endpoint, Ollama, vLLM...).
 * Configure LLM_BASE_URL, LLM_API_KEY and LLM_MODEL.
 *
 * Reliability:
 *  - every request has a timeout and honours the caller's AbortSignal
 *  - transient failures (HTTP 429 rate limits, 5xx, network errors, timeouts) are retried
 *    up to LLM_MAX_RETRIES times with exponential backoff (+ Retry-After when provided)
 *  - permanent failures (no credits / quota, invalid key, bad request) fail immediately so the
 *    engine can switch to its mechanical fallback instead of burning retries
 */

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("No LLM provider is configured (set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL)");
  }
}

export type LlmErrorKind = "quota" | "auth" | "rate_limit" | "server" | "timeout" | "network" | "bad_request" | "invalid_output";

export class LlmError extends Error {
  constructor(
    message: string,
    public kind: LlmErrorKind = "server",
    public status?: number,
  ) {
    super(message);
  }
  /** Whether a later attempt (job-level retry) could plausibly succeed. */
  get transient() {
    return this.kind === "rate_limit" || this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

function cfg() {
  if (!llmConfigured()) throw new LlmNotConfiguredError();
  const e = env();
  return {
    base: e.LLM_BASE_URL!.replace(/\/+$/, ""),
    key: e.LLM_API_KEY!,
    model: e.LLM_MODEL!,
    timeout: e.LLM_TIMEOUT_MS,
    jsonSchema: e.LLM_SUPPORTS_JSON_SCHEMA,
    retries: e.LLM_MAX_RETRIES,
  };
}

export function llmModelName(): string | undefined {
  return llmConfigured() ? env().LLM_MODEL : undefined;
}

/**
 * Estimated cost in USD. Prices are per 1M tokens and configurable because providers change
 * them; defaults are the published OpenAI list prices for gpt-4.1-mini. This is an estimate
 * for budgeting, not an invoice.
 */
export function estimateCostUsd(usage: Usage): number {
  const e = env();
  return (usage.promptTokens * e.LLM_PRICE_INPUT_PER_MTOK + usage.completionTokens * e.LLM_PRICE_OUTPUT_PER_MTOK) / 1_000_000;
}

function classify(status: number, body: string): LlmError {
  let code = "";
  let msg = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as { error?: { code?: string; type?: string; message?: string } };
    code = `${j.error?.code ?? ""} ${j.error?.type ?? ""}`;
    msg = j.error?.message?.slice(0, 300) ?? msg;
  } catch {
    // non-JSON error body
  }
  const text = `LLM request failed (HTTP ${status}): ${msg}`;
  if (/insufficient_quota|credit_balance|billing/i.test(code + msg)) return new LlmError(text, "quota", status);
  if (status === 401 || status === 403) return new LlmError(text, "auth", status);
  if (status === 429) return new LlmError(text, "rate_limit", status);
  if (status >= 500) return new LlmError(text, "server", status);
  return new LlmError(text, "bad_request", status);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new LlmError("LLM request aborted", "timeout"));
      },
      { once: true },
    );
  });

async function postOnce(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(`${c.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${c.key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = classify(res.status, await res.text().catch(() => ""));
      const retryAfter = Number(res.headers.get("retry-after"));
      (err as LlmError & { retryAfterMs?: number }).retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined;
      throw err;
    }
    return res;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw new LlmError("LLM request timed out", "timeout");
    throw new LlmError(err instanceof Error ? err.message : String(err), "network");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const { retries } = cfg();
  for (let attempt = 0; ; attempt++) {
    try {
      return await postOnce(path, body, signal);
    } catch (err) {
      const e = err as LlmError & { retryAfterMs?: number };
      if (!(e instanceof LlmError) || !e.transient || attempt >= retries || signal?.aborted) throw e;
      await sleep(Math.min(20_000, e.retryAfterMs ?? 1000 * 2 ** attempt), signal);
    }
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new LlmError("Model did not return JSON", "invalid_output");
  }
}

interface CompletionResponse {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

/**
 * Structured output: the response is validated against a Zod schema. One repair
 * attempt is made with the validation errors; otherwise an error is thrown.
 */
export async function chatJson<S extends ZodTypeAny>(opts: {
  messages: ChatMessage[];
  schema: S;
  schemaName: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<{ data: output<S>; usage: Usage; model: string }> {
  const c = cfg();
  const jsonSchema = zodToJsonSchema(opts.schema, { target: "openApi3", $refStrategy: "none" });
  const responseFormat = c.jsonSchema
    ? { type: "json_schema", json_schema: { name: opts.schemaName, schema: jsonSchema, strict: false } }
    : { type: "json_object" };
  const schemaHint: ChatMessage = {
    role: "system",
    content: `Respond with a single JSON object that conforms to this JSON Schema. Do not include prose outside the JSON.\n${JSON.stringify(jsonSchema)}`,
  };

  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  let messages: ChatMessage[] = [...opts.messages, schemaHint];
  let model = c.model;
  let maxTokens = opts.maxTokens ?? 2500;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await post(
      "/chat/completions",
      {
        model: c.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: maxTokens,
        response_format: responseFormat,
      },
      opts.signal,
    );
    const json = (await res.json()) as CompletionResponse;
    usage.promptTokens += json.usage?.prompt_tokens ?? 0;
    usage.completionTokens += json.usage?.completion_tokens ?? 0;
    model = json.model ?? model;
    const content = json.choices?.[0]?.message?.content ?? "";
    // Output cut off by the token limit: retry once from the original prompt with more room
    // (found in a live run where a long report was truncated mid-JSON).
    if (json.choices?.[0]?.finish_reason === "length") {
      if (attempt === 1) throw Object.assign(new LlmError("Model output exceeded the token limit", "invalid_output"), { usage });
      maxTokens = Math.min(16_000, Math.ceil(maxTokens * 1.75));
      messages = [...opts.messages, schemaHint, { role: "user", content: "Your previous answer was too long and was cut off. Be more concise and return the complete JSON object." }];
      continue;
    }
    let parsed: unknown;
    try {
      parsed = extractJson(content);
    } catch (e) {
      if (attempt === 1) throw Object.assign(e as LlmError, { usage });
      messages = [...messages, { role: "assistant", content }, { role: "user", content: "That was not valid JSON. Return only the JSON object." }];
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return { data: result.data as output<S>, usage, model };
    if (attempt === 1) {
      throw Object.assign(
        new LlmError(
          `Model output failed validation: ${result.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; ")}`,
          "invalid_output",
        ),
        { usage },
      );
    }
    messages = [
      ...messages,
      { role: "assistant", content },
      {
        role: "user",
        content: `The JSON did not match the schema: ${result.error.issues
          .slice(0, 8)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}. Return a corrected JSON object only.`,
      },
    ];
  }
  throw new LlmError("unreachable", "invalid_output");
}

/**
 * One tool-calling turn. The caller owns the loop, executes tools itself, and decides when
 * to stop — the model can only *request* tools from the provided list.
 */
export async function chatWithTools(opts: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<{ content: string | null; toolCalls: ToolCall[]; usage: Usage; model: string; finishReason?: string }> {
  const c = cfg();
  const res = await post(
    "/chat/completions",
    {
      model: c.model,
      messages: opts.messages,
      tools: opts.tools,
      tool_choice: opts.toolChoice ?? "auto",
      parallel_tool_calls: true,
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? 1200,
    },
    opts.signal,
  );
  const json = (await res.json()) as CompletionResponse;
  const choice = json.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: (choice?.message?.tool_calls ?? []).filter((t) => t?.type === "function" && t.function?.name),
    usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 },
    model: json.model ?? c.model,
    finishReason: choice?.finish_reason,
  };
}

/** Streams assistant text deltas. Calls onDone with token usage when the provider reports it. */
export async function* chatStream(opts: {
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  onDone?: (usage: Usage, model: string) => void | Promise<void>;
}): AsyncGenerator<string> {
  const c = cfg();
  const res = await post(
    "/chat/completions",
    {
      model: c.model,
      messages: opts.messages,
      temperature: 0.3,
      max_tokens: opts.maxTokens ?? 900,
      stream: true,
      stream_options: { include_usage: true },
    },
    opts.signal,
  );
  if (!res.body) throw new LlmError("Empty response stream", "server");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  let produced = 0;
  let model = c.model;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const evt = JSON.parse(data) as {
          model?: string;
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        if (evt.model) model = evt.model;
        if (evt.usage) {
          usage.promptTokens = evt.usage.prompt_tokens ?? usage.promptTokens;
          usage.completionTokens = evt.usage.completion_tokens ?? usage.completionTokens;
        }
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) {
          produced += delta.length;
          yield delta;
        }
      } catch {
        // ignore keep-alive / malformed lines
      }
    }
  }
  // Providers that do not report usage: estimate (~4 chars per token) for budgeting only.
  if (!usage.completionTokens) usage.completionTokens = Math.ceil(produced / 4);
  if (!usage.promptTokens) {
    usage.promptTokens = Math.ceil(opts.messages.reduce((s, m) => s + (("content" in m && m.content) || "").length, 0) / 4);
  }
  await opts.onDone?.(usage, model);
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  const e = env();
  if (!llmConfigured() || !e.LLM_EMBEDDING_MODEL || !texts.length) return null;
  const res = await post("/embeddings", { model: e.LLM_EMBEDDING_MODEL, input: texts });
  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  return json.data?.map((d) => d.embedding) ?? null;
}
