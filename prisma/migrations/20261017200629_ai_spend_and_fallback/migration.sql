-- AlterTable
ALTER TABLE "AgentConfig" ADD COLUMN     "dailySpendLimitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.25;

-- AlterTable
ALTER TABLE "AgentExecution" ADD COLUMN     "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fallbackReason" TEXT,
ADD COLUMN     "mode" TEXT;

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
