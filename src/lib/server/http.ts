import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { Prisma } from "@prisma/client";

/** Consistent API error shape: { error: { code, message, details? } } */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Sign in with your wallet to continue") =>
  new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);
export const tooMany = (message = "Too many requests, please slow down", retryAfter?: number) =>
  new ApiError(429, "RATE_LIMITED", message, retryAfter ? { retryAfter } : undefined);
export const unavailable = (message: string, details?: unknown) =>
  new ApiError(503, "SERVICE_UNAVAILABLE", message, details);

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields are invalid",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "A record with these values already exists" } },
      { status: 409 },
    );
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error("[api] database unavailable", err.message);
    return NextResponse.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: "The database is not reachable" } },
      { status: 503 },
    );
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with consistent error handling. */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** JSON.stringify replacer-safe conversion for BigInt fields. */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}
