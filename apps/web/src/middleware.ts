import { NextResponse, type NextRequest } from "next/server";

// Answers CORS preflights for the extension and gives every browser visitor a
// workspace cookie so several judges can use the deployed app at once.

// The extension authenticates with the X-SR-Token header, never with cookies, so
// no Allow-Credentials is needed and reflecting its origin is safe. Browser
// pages on the app's own origin are same-origin and never hit CORS.
function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  let appOrigin = "";
  try {
    appOrigin = new URL(process.env.APP_BASE_URL ?? "").origin;
  } catch {
    appOrigin = "";
  }
  const allow = origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://") || (appOrigin && origin === appOrigin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-SR-Token",
    "Access-Control-Expose-Headers": "X-SR-Run-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: cors });
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }
  const res = NextResponse.next();
  if (!req.nextUrl.pathname.startsWith("/open") && !req.cookies.get("sr_account")?.value) {
    res.cookies.set("sr_account", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|logo-lockup.png|logo-mark.png|icon.png|apple-icon.png).*)"],
};
