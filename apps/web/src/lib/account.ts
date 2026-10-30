import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAccountByToken, getOrCreateAccount, type AccountRow } from "./db";

// Resolves the caller's workspace: the extension sends X-SR-Token, the browser
// carries the sr_account cookie set by the middleware.

export async function currentAccount(): Promise<AccountRow> {
  const token = headers().get("x-sr-token");
  if (token) {
    const acct = await getAccountByToken(token.trim());
    if (!acct) throw new ApiError(401, "Unknown account token. Copy it from the Settings page.");
    return acct;
  }
  const id = cookies().get("sr_account")?.value;
  if (!id) throw new ApiError(401, "No workspace cookie. Open the app in a browser first.");
  return getOrCreateAccount(id);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200 });
}

export function fail(err: unknown) {
  const status = err instanceof ApiError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error("[shop-rules]", message);
  return NextResponse.json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
