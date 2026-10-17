import "server-only";
import { db } from "@/lib/db";
import { tooMany } from "./http";

/**
 * Fixed-window rate limiter backed by PostgreSQL so limits hold across serverless
 * instances. A single atomic upsert per check.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds}::float8)
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds}::float8)
                     THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"`;
  const row = rows[0];
  if (row && row.count > limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((row.windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000),
    );
    throw tooMany(undefined, retryAfter);
  }
}
