-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RwaSpecialization" AS ENUM ('GOLD', 'TREASURIES', 'REAL_ESTATE', 'PRIVATE_CREDIT', 'COMMODITIES', 'MULTI_ASSET');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AutonomyMode" AS ENUM ('MANUAL', 'SCHEDULED', 'EVENT_TRIGGERED', 'CONTINUOUS');

-- CreateEnum
CREATE TYPE "RiskSensitivity" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "ReportingStyle" AS ENUM ('CONCISE', 'DETAILED', 'INSTITUTIONAL');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RESEARCHING', 'ANALYZING', 'PUBLISHING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'EVENT');

-- CreateEnum
CREATE TYPE "StepKind" AS ENUM ('PLAN', 'TOOL_CALL', 'ANALYSIS', 'LLM_CALL', 'PUBLISH', 'MEMORY', 'ERROR');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('REPORT_SUMMARY', 'FINDING', 'EXECUTION_SUMMARY', 'SOURCE_REFERENCE', 'OBJECTIVE', 'CONFIG_CHANGE', 'ASSET_SNAPSHOT');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MODERATE', 'ELEVATED', 'HIGH');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('AGENT_CREATED', 'AGENT_ACTIVATED', 'AGENT_PAUSED', 'AGENT_RESUMED', 'AGENT_DISABLED', 'RESEARCH_STARTED', 'RESEARCH_COMPLETED', 'RESEARCH_FAILED', 'REPORT_PUBLISHED', 'MONITOR_ALERT', 'TOKEN_SUBMITTED', 'TOKEN_CONFIRMED', 'TOKEN_FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageId" TEXT,
    "specialization" "RwaSpecialization" NOT NULL,
    "objectives" TEXT[],
    "status" "AgentStatus" NOT NULL DEFAULT 'DRAFT',
    "adminDisabled" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "researchObjectives" TEXT[],
    "dataSources" TEXT[],
    "customSourceUrls" TEXT[],
    "riskSensitivity" "RiskSensitivity" NOT NULL DEFAULT 'BALANCED',
    "reportingStyle" "ReportingStyle" NOT NULL DEFAULT 'DETAILED',
    "monitoringCriteria" JSONB NOT NULL,
    "focusAssets" TEXT[],
    "maxToolCalls" INTEGER NOT NULL DEFAULT 12,
    "dailyRunLimit" INTEGER NOT NULL DEFAULT 6,
    "dailyTokenBudget" INTEGER NOT NULL DEFAULT 60000,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSchedule" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "mode" "AutonomyMode" NOT NULL DEFAULT 'MANUAL',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 360,
    "monitorMinutes" INTEGER NOT NULL DEFAULT 30,
    "nextRunAt" TIMESTAMP(3),
    "nextMonitorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDraft" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "ExecutionTrigger" NOT NULL,
    "triggerReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "plan" JSONB,
    "summary" TEXT,
    "error" TEXT,
    "llmModel" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecutionStep" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" "StepKind" NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "agentId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "data" JSONB,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "embedding" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchReport" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "methodology" TEXT NOT NULL,
    "narrativeBy" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "dataTimestamp" TIMESTAMP(3),
    "stale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAsset" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "factors" JSONB NOT NULL,

    CONSTRAINT "ReportAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoredAsset" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lastSnapshot" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoredAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCache" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProviderHealth" (
    "providerId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "latencyMs" INTEGER,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderHealth_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE "TokenDeployment" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "mechanism" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "tokenName" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "totalSupply" TEXT NOT NULL,
    "imageId" TEXT,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PREPARED',
    "contractAddress" TEXT,
    "txHash" TEXT,
    "blockNumber" BIGINT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "TokenDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainTransaction" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT,
    "chainId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blockNumber" BIGINT,
    "gasUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockchainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMarketStats" (
    "agentId" TEXT NOT NULL,
    "runs7d" INTEGER NOT NULL DEFAULT 0,
    "successfulRuns7d" INTEGER NOT NULL DEFAULT 0,
    "reports7d" INTEGER NOT NULL DEFAULT 0,
    "chats7d" INTEGER NOT NULL DEFAULT 0,
    "trendingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMarketStats_pkey" PRIMARY KEY ("agentId")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "agentId" TEXT,
    "actor" TEXT,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT,
    "visitorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAbuseReport" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAbuseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastBeatAt" TIMESTAMP(3) NOT NULL,
    "jobsDone" INTEGER NOT NULL DEFAULT 0,
    "jobsFailed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletIdentity_address_key" ON "WalletIdentity"("address");

-- CreateIndex
CREATE INDEX "WalletIdentity_userId_idx" ON "WalletIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonce_key" ON "AuthNonce"("nonce");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE INDEX "Agent_ownerId_idx" ON "Agent"("ownerId");

-- CreateIndex
CREATE INDEX "Agent_status_adminDisabled_idx" ON "Agent"("status", "adminDisabled");

-- CreateIndex
CREATE INDEX "Agent_specialization_idx" ON "Agent"("specialization");

-- CreateIndex
CREATE INDEX "Agent_createdAt_idx" ON "Agent"("createdAt");

-- CreateIndex
CREATE INDEX "Agent_lastSuccessAt_idx" ON "Agent"("lastSuccessAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfig_agentId_key" ON "AgentConfig"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSchedule_agentId_key" ON "AgentSchedule"("agentId");

-- CreateIndex
CREATE INDEX "AgentSchedule_mode_nextRunAt_idx" ON "AgentSchedule"("mode", "nextRunAt");

-- CreateIndex
CREATE INDEX "AgentSchedule_mode_nextMonitorAt_idx" ON "AgentSchedule"("mode", "nextMonitorAt");

-- CreateIndex
CREATE INDEX "AgentDraft_ownerId_updatedAt_idx" ON "AgentDraft"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_idempotencyKey_key" ON "AgentExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentExecution_agentId_queuedAt_idx" ON "AgentExecution"("agentId", "queuedAt");

-- CreateIndex
CREATE INDEX "AgentExecution_status_idx" ON "AgentExecution"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecutionStep_executionId_index_key" ON "AgentExecutionStep"("executionId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_agentId_idx" ON "Job"("agentId");

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_kind_createdAt_idx" ON "AgentMemory"("agentId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchReport_executionId_key" ON "ResearchReport"("executionId");

-- CreateIndex
CREATE INDEX "ResearchReport_agentId_createdAt_idx" ON "ResearchReport"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchReport_createdAt_idx" ON "ResearchReport"("createdAt");

-- CreateIndex
CREATE INDEX "ResearchSource_reportId_idx" ON "ResearchSource"("reportId");

-- CreateIndex
CREATE INDEX "ReportAsset_reportId_idx" ON "ReportAsset"("reportId");

-- CreateIndex
CREATE INDEX "ReportAsset_assetKey_idx" ON "ReportAsset"("assetKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredAsset_agentId_assetKey_key" ON "MonitoredAsset"("agentId", "assetKey");

-- CreateIndex
CREATE UNIQUE INDEX "TokenDeployment_txHash_key" ON "TokenDeployment"("txHash");

-- CreateIndex
CREATE INDEX "TokenDeployment_agentId_idx" ON "TokenDeployment"("agentId");

-- CreateIndex
CREATE INDEX "TokenDeployment_creatorId_idx" ON "TokenDeployment"("creatorId");

-- CreateIndex
CREATE INDEX "TokenDeployment_status_idx" ON "TokenDeployment"("status");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_from_idx" ON "BlockchainTransaction"("from");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainTransaction_chainId_hash_key" ON "BlockchainTransaction"("chainId", "hash");

-- CreateIndex
CREATE INDEX "AgentMarketStats_trendingScore_idx" ON "AgentMarketStats"("trendingScore");

-- CreateIndex
CREATE INDEX "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_agentId_createdAt_idx" ON "ActivityEvent"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_type_idx" ON "ActivityEvent"("type");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationChannel_userId_idx" ON "NotificationChannel"("userId");

-- CreateIndex
CREATE INDEX "ChatConversation_agentId_idx" ON "ChatConversation"("agentId");

-- CreateIndex
CREATE INDEX "ChatConversation_userId_idx" ON "ChatConversation"("userId");

-- CreateIndex
CREATE INDEX "ChatConversation_visitorId_idx" ON "ChatConversation"("visitorId");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_agentId_createdAt_idx" ON "UsageRecord"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_kind_createdAt_idx" ON "UsageRecord"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AgentAbuseReport_status_createdAt_idx" ON "AgentAbuseReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAbuseReport_agentId_reporterId_key" ON "AgentAbuseReport"("agentId", "reporterId");

-- CreateIndex
CREATE INDEX "Media_ownerId_idx" ON "Media"("ownerId");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_lastBeatAt_idx" ON "WorkerHeartbeat"("lastBeatAt");

-- AddForeignKey
ALTER TABLE "WalletIdentity" ADD CONSTRAINT "WalletIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSchedule" ADD CONSTRAINT "AgentSchedule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDraft" ADD CONSTRAINT "AgentDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecutionStep" ADD CONSTRAINT "AgentExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ResearchReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAsset" ADD CONSTRAINT "ReportAsset_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ResearchReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredAsset" ADD CONSTRAINT "MonitoredAsset_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenDeployment" ADD CONSTRAINT "TokenDeployment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenDeployment" ADD CONSTRAINT "TokenDeployment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "TokenDeployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMarketStats" ADD CONSTRAINT "AgentMarketStats_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAbuseReport" ADD CONSTRAINT "AgentAbuseReport_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAbuseReport" ADD CONSTRAINT "AgentAbuseReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
