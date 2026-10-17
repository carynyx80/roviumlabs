-- One verified token per agent, and at most one in-flight (submitted) deployment per agent.
CREATE UNIQUE INDEX "TokenDeployment_one_confirmed_per_agent" ON "TokenDeployment" ("agentId") WHERE "status" = 'CONFIRMED';
CREATE UNIQUE INDEX "TokenDeployment_one_submitted_per_agent" ON "TokenDeployment" ("agentId") WHERE "status" = 'SUBMITTED';
