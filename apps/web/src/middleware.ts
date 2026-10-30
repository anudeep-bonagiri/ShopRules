import { NextResponse, type NextRequest } from "next/server";

// Answers CORS preflights for the extension and gives every browser visitor a
// workspace cookie so several judges can use the deployed app at once.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-SR-Token",
  "Access-Control-Max-Age": "86400",
};

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: CORS });
    return NextResponse.next();
  }
  const res = NextResponse.next();
  if (!req.cookies.get("sr_account")?.value) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg|icon.svg).*)"],
};
