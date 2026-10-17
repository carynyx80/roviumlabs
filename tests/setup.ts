// Tests run against an isolated database (TEST_DATABASE_URL), never the development one.
// Unit tests that do not touch the database work without it.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://rovium:rovium@localhost:5433/roviumpad_test?schema=public";
process.env.SESSION_SECRET ??= "test-session-secret-that-is-long-enough-123";
process.env.APP_URL ??= "http://localhost:3000";
// Never call a real LLM from automated tests.
delete process.env.LLM_API_KEY;
delete process.env.LLM_BASE_URL;
delete process.env.LLM_MODEL;
delete process.env.REDIS_URL;
