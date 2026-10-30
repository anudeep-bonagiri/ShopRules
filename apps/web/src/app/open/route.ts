import { NextResponse } from "next/server";
import { getAccountByToken } from "@/lib/db";

export const dynamic = "force-dynamic";

// /open?token=sr_live_... opens an existing workspace in this browser (a phone,
// a second laptop) by setting the workspace cookie, then goes to the Watchlist.
// An unknown token goes to Settings with a notice instead of a new workspace.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  const account = token ? await getAccountByToken(token).catch(() => null) : null;
  if (!account) {
    return NextResponse.redirect(new URL("/settings?open=invalid", url.origin));
  }
  const res = NextResponse.redirect(new URL("/?opened=1", url.origin));
  res.cookies.set("sr_account", account.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
