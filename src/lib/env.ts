import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated once at first use.
 * Nothing in here is ever imported by client components ("server-only" enforces it).
 */
const boolish = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional().transform((v) => v || undefined),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .default("dev-only-insecure-session-secret-change-me-please"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  ADMIN_WALLETS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean) : [])),

  // LLM (any OpenAI-compatible /chat/completions endpoint)
  LLM_BASE_URL: z.string().url().optional().or(z.literal("")).transform((v) => v || undefined),
  LLM_API_KEY: z.string().optional().transform((v) => v || undefined),
  LLM_MODEL: z.string().optional().transform((v) => v || undefined),
  LLM_EMBEDDING_MODEL: z.string().optional().transform((v) => v || undefined),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  LLM_SUPPORTS_JSON_SCHEMA: boolish,
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  // USD per 1M tokens, used for spend estimates/limits. Defaults: OpenAI gpt-4.1-mini list prices.
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0.4),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(1.6),
  // Hard ceiling on AI research iterations (model turns) per run.
  AI_MAX_RESEARCH_TURNS: z.coerce.number().int().min(1).max(12).default(6),
  PLATFORM_DAILY_LLM_SPEND_USD: z.coerce.number().min(0).default(5),

  // Optional data providers
  FRED_API_KEY: z.string().optional().transform((v) => v || undefined),

  // Chain (server-side RPCs may contain API keys; never exposed to the client)
  RPC_URL_LOCALHOST: z.string().optional().transform((v) => v || undefined),
  RPC_URL_ROBINHOOD_TESTNET: z.string().optional().transform((v) => v || undefined),
  RPC_URL_ROBINHOOD_MAINNET: z.string().optional().transform((v) => v || undefined),

  // Abuse / cost controls
  CHAT_MESSAGES_PER_HOUR: z.coerce.number().int().positive().default(20),
  CHAT_DAILY_TOKEN_BUDGET_PER_AGENT: z.coerce.number().int().positive().default(100000),
  PLATFORM_DAILY_LLM_TOKEN_BUDGET: z.coerce.number().int().positive().default(2000000),
  MAX_ACTIVE_AGENTS_PER_USER: z.coerce.number().int().positive().default(10),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // Hosts like Railway/Render assign PORT and health-check it; fall back to 8081 locally.
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(Number(process.env.PORT) || 8081),
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * The HMAC secret, validated where it is used (signed visitor cookies) rather than in env(),
 * so a missing secret disables only the features that need it instead of every page.
 */
export function sessionSecret(): string {
  const s = env().SESSION_SECRET;
  if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  if (env().NODE_ENV === "production" && s.startsWith("dev-only")) {
    throw new Error("SESSION_SECRET must be set to a strong random value in production");
  }
  return s;
}

export function llmConfigured(): boolean {
  const e = env();
  return Boolean(e.LLM_BASE_URL && e.LLM_API_KEY && e.LLM_MODEL);
}
