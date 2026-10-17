import { NextResponse, type NextRequest } from "next/server";

/**
 * - CSRF: state-changing API requests must come from this origin (Origin/Referer check).
 *   Session cookies are also SameSite=Lax and httpOnly.
 * - Security headers on every response.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/") && !SAFE.has(req.method)) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const origin = req.headers.get("origin") ?? req.headers.get("referer");
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== host) {
      return NextResponse.json(
        { error: { code: "CSRF_REJECTED", message: "Cross-site request rejected" } },
        { status: 403 },
      );
    }
  }
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|icon.png|apple-icon.png).*)"],
};
