import { z } from "zod";
import { PROVIDERS } from "@/lib/providers/registry";

/** Client + server validation for agent configuration. */

const providerIds = PROVIDERS.map((p) => p.id) as [string, ...string[]];

const cleanText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, `Must be at least ${min} characters`)
    .max(max, `Must be at most ${max} characters`)
    // strip control characters other than newline / tab
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));

export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, "2–10 letters or digits");

export const httpsUrl = z
  .string()
  .trim()
  .url("Must be a valid URL")
  .refine((u) => u.startsWith("https://"), "Only https:// URLs are allowed")
  .refine((u) => u.length <= 500, "URL is too long");

export const monitoringSchema = z.object({
  priceChangePct: z.coerce.number().min(0.1).max(50),
  yieldChangeBps: z.coerce.number().int().min(5).max(2000),
  tvlChangePct: z.coerce.number().min(1).max(90),
  staleDataHours: z.coerce.number().int().min(1).max(24 * 30),
});

export const identitySchema = z.object({
  name: cleanText(48, 3),
  ticker: tickerSchema,
  description: cleanText(600, 20),
  imageId: z.string().cuid().optional().nullable(),
  specialization: z.enum(["GOLD", "TREASURIES", "REAL_ESTATE", "PRIVATE_CREDIT", "COMMODITIES", "MULTI_ASSET"]),
  objectives: z.array(cleanText(200, 3)).min(1, "Add at least one objective").max(6),
});

export const intelligenceSchema = z.object({
  researchObjectives: z.array(cleanText(240, 3)).min(1, "Add at least one research objective").max(8),
  dataSources: z.array(z.enum(providerIds)).min(1, "Choose at least one data source"),
  customSourceUrls: z.array(httpsUrl).max(5).default([]),
  focusAssets: z.array(cleanText(40, 2)).max(10).default([]),
  riskSensitivity: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]),
  reportingStyle: z.enum(["CONCISE", "DETAILED", "INSTITUTIONAL"]),
  monitoringCriteria: monitoringSchema,
});

export const autonomySchema = z.object({
  mode: z.enum(["MANUAL", "SCHEDULED", "EVENT_TRIGGERED", "CONTINUOUS"]),
  intervalMinutes: z.coerce.number().int().min(60).max(10080),
  monitorMinutes: z.coerce.number().int().min(15).max(1440),
});

export const createAgentSchema = z.object({
  identity: identitySchema,
  intelligence: intelligenceSchema,
  autonomy: autonomySchema,
  activate: z.boolean().default(false),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

/** Fields a creator may edit after creation. Name/ticker/specialization are fixed for marketplace integrity. */
export const updateAgentSchema = z.object({
  description: identitySchema.shape.description.optional(),
  imageId: identitySchema.shape.imageId,
  objectives: identitySchema.shape.objectives.optional(),
  intelligence: intelligenceSchema.partial().optional(),
  autonomy: autonomySchema.partial().optional(),
  limits: z
    .object({
      dailySpendLimitUsd: z.coerce.number().min(0, "Cannot be negative").max(5, "Maximum $5.00 per day"),
      dailyRunLimit: z.coerce.number().int().min(1).max(24),
    })
    .partial()
    .optional(),
});

export const tokenLaunchSchema = z.object({
  mechanism: z.literal("standard-erc20"),
  chainId: z.number().int().positive(),
  tokenName: cleanText(40, 3),
  tokenSymbol: tickerSchema,
  totalSupply: z
    .string()
    .trim()
    .regex(/^[1-9]\d{0,14}$/, "Whole number between 1 and 999,999,999,999,999"),
  // Required by the server when the target network is a mainnet (real funds).
  acknowledgeMainnet: z.boolean().optional(),
  acknowledgeDisclosure: z.literal(true, {
    errorMap: () => ({ message: "You must acknowledge the token disclosure" }),
  }),
});

export const draftSchema = z.object({
  id: z.string().cuid().optional(),
  step: z.number().int().min(0).max(10),
  data: z.record(z.unknown()).refine((d) => JSON.stringify(d).length < 20_000, "Draft too large"),
});
