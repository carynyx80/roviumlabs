-- Live AI runs use ~15-30k tokens each; 60k/day allowed only 2-3 runs. USD spend limit remains the primary cap.
ALTER TABLE "AgentConfig" ALTER COLUMN "dailyTokenBudget" SET DEFAULT 250000;
UPDATE "AgentConfig" SET "dailyTokenBudget" = 250000 WHERE "dailyTokenBudget" = 60000;
