// Storage client: Vercel Blob when a token is present, otherwise a file-backed
// store with the same four calls and the same semantics db.ts relies on
// (create-only put unless allowOverwrite, list by prefix with folded folders,
// get by pathname or url, del by url). See offline.ts.
import * as vercel from "@vercel/blob";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { localStoreDir, offlineMode } from "./offline";

const LOCAL_PREFIX = "local://";

function root(): string {
  const dir = localStoreDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pathnameOf(pathOrUrl: string): string {
  return pathOrUrl.startsWith(LOCAL_PREFIX) ? pathOrUrl.slice(LOCAL_PREFIX.length) : pathOrUrl.replace(/^https?:\/\/[^/]+\//, "");
}

function filePath(pathname: string): string {
  const safe = pathname.split("/").filter((p) => p && p !== "..").join(sep);
  return join(root(), safe);
}

type PutOptions = { access?: "private" | "public"; addRandomSuffix?: boolean; allowOverwrite?: boolean; contentType?: string; cacheControlMaxAge?: number; ifMatch?: string };

async function localPut(pathname: string, body: string | Buffer | Blob, opts: PutOptions = {}): Promise<{ url: string; pathname: string }> {
  const file = filePath(pathname);
  if (!opts.allowOverwrite && existsSync(file)) {
    const err = new Error(`Blob already exists: ${pathname}`) as Error & { code?: string };
    err.code = "blob_already_exists";
    throw err;
  }
  mkdirSync(dirname(file), { recursive: true });
  const data = typeof body === "string" ? body : body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : body;
  writeFileSync(file, data);
  return { url: `${LOCAL_PREFIX}${pathname}`, pathname };
}

async function localGet(pathOrUrl: string): Promise<{ stream: ReadableStream<Uint8Array>; etag: string } | null> {
  const file = filePath(pathnameOf(pathOrUrl));
  if (!existsSync(file)) return null;
  const text = readFileSync(file);
  return { stream: new Blob([text]).stream(), etag: String(statSync(file).mtimeMs) };
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

async function localList(opts: { prefix?: string; cursor?: string; limit?: number; mode?: "expanded" | "folded" } = {}): Promise<{ blobs: Array<{ pathname: string; url: string }>; folders?: string[]; hasMore: boolean; cursor?: string }> {
  const prefix = opts.prefix ?? "";
  const files: string[] = [];
  walk(root(), files);
  const all = files
    .map((f) => relative(root(), f).split(sep).join("/"))
    .filter((p) => p.startsWith(prefix))
    .sort();
  if (opts.mode === "folded") {
    const folders = new Set<string>();
    const blobs: Array<{ pathname: string; url: string }> = [];
    for (const p of all) {
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(`${prefix}${rest.slice(0, slash + 1)}`);
      else blobs.push({ pathname: p, url: `${LOCAL_PREFIX}${p}` });
    }
    return { blobs, folders: Array.from(folders).sort(), hasMore: false };
  }
  return { blobs: all.map((p) => ({ pathname: p, url: `${LOCAL_PREFIX}${p}` })), hasMore: false };
}

async function localDel(urlOrUrls: string | string[]): Promise<void> {
  for (const u of Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls]) rmSync(filePath(pathnameOf(u)), { force: true });
}

const useLocal = () => offlineMode().store === "local";

export const put: typeof vercel.put = ((pathname: string, body: string | Buffer | Blob, opts?: PutOptions) => (useLocal() ? localPut(pathname, body, opts) : vercel.put(pathname, body as never, opts as never))) as typeof vercel.put;
export const get: typeof vercel.get = ((pathOrUrl: string, opts?: unknown) => (useLocal() ? localGet(pathOrUrl) : vercel.get(pathOrUrl, opts as never))) as typeof vercel.get;
export const list: typeof vercel.list = ((opts?: unknown) => (useLocal() ? localList(opts as never) : vercel.list(opts as never))) as typeof vercel.list;
export const del: typeof vercel.del = ((urls: string | string[], opts?: unknown) => (useLocal() ? localDel(urls) : vercel.del(urls, opts as never))) as typeof vercel.del;
