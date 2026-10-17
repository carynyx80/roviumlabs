-- Concurrency control: at most one in-flight execution per agent.
-- Prisma cannot express partial indexes in the schema, so this lives in raw SQL.
CREATE UNIQUE INDEX "AgentExecution_one_active_per_agent"
  ON "AgentExecution" ("agentId")
  WHERE "status" IN ('QUEUED', 'RESEARCHING', 'ANALYZING', 'PUBLISHING');

-- Sanity constraints the ORM cannot express.
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_riskScore_range" CHECK ("riskScore" BETWEEN 0 AND 100);
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_confidence_range" CHECK ("confidence" BETWEEN 0 AND 100);
ALTER TABLE "Media" ADD CONSTRAINT "Media_size_limit" CHECK (octet_length("bytes") <= 2000000);
