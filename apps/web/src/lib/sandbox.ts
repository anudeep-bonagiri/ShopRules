// Nebius Token Factory Sandboxes (Contree) REST client. A sandbox is a
// hardware-isolated container that runs one command and returns its output.
// Shop Rules uses it to execute the check scripts the coding agent writes.
// Docs: https://docs.tokenfactory.nebius.com/sandboxes/reference/index.md

const BASE = process.env.NEBIUS_SANDBOX_BASE_URL || "https://api.tokenfactory.nebius.com/sandboxes/v1";

export interface SandboxRun {
  ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  operation_id: string | null;
  image: string;
  error: string | null;
  cost: number | null;
}

export function sandboxConfigured(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY && process.env.NEBIUS_PROJECT_ID);
}

export function sandboxImage(): string {
  return process.env.NEBIUS_SANDBOX_IMAGE || "tag:python:3.12-slim";
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
    Project: process.env.NEBIUS_PROJECT_ID as string,
  };
}

function shellQuoteHeredoc(name: string, content: string): string {
  // Write a file with a quoted heredoc so nothing inside is expanded. The
  // delimiter is unlikely to appear in generated code.
  const delim = "SHOPRULES_EOF_7f3a";
  const safe = content.replace(new RegExp(delim, "g"), "SHOPRULES_EOF_X");
  return `cat > /work/${name} <<'${delim}'\n${safe}\n${delim}\n`;
}

export interface SandboxRequest {
  files: Record<string, string>;
  command: string;
  timeoutSeconds?: number;
  network?: boolean;
}

// Runs one command in a disposable sandbox after writing the given files to /work.
export async function runInSandbox(req: SandboxRequest): Promise<SandboxRun> {
  const started = Date.now();
  const image = sandboxImage();
  if (!sandboxConfigured()) {
    return { ok: false, exit_code: null, stdout: "", stderr: "", ms: 0, operation_id: null, image, error: "Sandboxes are not configured: set NEBIUS_PROJECT_ID (Token Factory project settings) next to NEBIUS_API_KEY.", cost: null };
  }
  const script = ["set -e", "mkdir -p /work", "cd /work", ...Object.entries(req.files).map(([n, c]) => shellQuoteHeredoc(n, c)), req.command].join("\n");
  const body: Record<string, unknown> = {
    image,
    command: script,
    shell: true,
    disposable: true,
    cwd: "/work",
    timeout: req.timeoutSeconds ?? 90,
    truncate_output_at: 200_000,
    env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
  };
  if (req.network === false) body.networking = { enabled: false };

  let opId: string | null = null;
  try {
    const res = await fetch(`${BASE}/instances`, { method: "POST", headers: headers(), body: JSON.stringify(body), cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, exit_code: null, stdout: "", stderr: "", ms: Date.now() - started, operation_id: null, image, error: `Sandbox spawn failed (${res.status}): ${text.slice(0, 300)}`, cost: null };
    }
    const loc = res.headers.get("location");
    let parsed: { uuid?: string; operation?: { uuid?: string }; id?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    opId = parsed.uuid ?? parsed.operation?.uuid ?? parsed.id ?? (loc ? loc.split("/").pop() ?? null : null);
  } catch (err) {
    return { ok: false, exit_code: null, stdout: "", stderr: "", ms: Date.now() - started, operation_id: null, image, error: `Sandbox spawn error: ${err instanceof Error ? err.message : String(err)}`, cost: null };
  }
  if (!opId) {
    return { ok: false, exit_code: null, stdout: "", stderr: "", ms: Date.now() - started, operation_id: null, image, error: "Sandbox spawn returned no operation id", cost: null };
  }

  const deadline = Date.now() + ((req.timeoutSeconds ?? 90) + 60) * 1000;
  let delay = 800;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 3000);
    let op: Record<string, unknown>;
    try {
      const res = await fetch(`${BASE}/operations/${opId}`, { headers: headers(), cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, exit_code: null, stdout: "", stderr: "", ms: Date.now() - started, operation_id: opId, image, error: `Sandbox status failed (${res.status}): ${text.slice(0, 200)}`, cost: null };
      }
      op = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      return { ok: false, exit_code: null, stdout: "", stderr: "", ms: Date.now() - started, operation_id: opId, image, error: `Sandbox status error: ${err instanceof Error ? err.message : String(err)}`, cost: null };
    }
    const status = String(op.status ?? op.state ?? "").toLowerCase();
    const result = (op.result ?? op.instance_result ?? null) as Record<string, unknown> | null;
    const state = (result?.state ?? {}) as Record<string, unknown>;
    const exitCandidates = [result?.exit_code, state.exit_code, state.exit_status, op.exit_code];
    const exitCode = exitCandidates.find((v) => typeof v === "number") as number | undefined ?? null;
    const terminal = ["done", "completed", "complete", "finished", "succeeded", "success", "failed", "error", "cancelled", "canceled", "timeout", "killed"].includes(status) || exitCode !== null;
    if (!terminal) continue;
    const resources = (result?.resources ?? {}) as Record<string, unknown>;
    const stdout = String(result?.stdout ?? "");
    const stderr = String(result?.stderr ?? op.error ?? "");
    const failedStatus = ["failed", "error", "cancelled", "canceled", "timeout", "killed"].includes(status);
    return {
      ok: exitCode === 0 && !failedStatus,
      exit_code: exitCode,
      stdout,
      stderr,
      ms: Date.now() - started,
      operation_id: opId,
      image,
      error: failedStatus && exitCode === null ? `Sandbox operation ${status}: ${stderr.slice(0, 200)}` : null,
      cost: typeof resources.cost === "number" ? (resources.cost as number) : null,
    };
  }
  return { ok: false, exit_code: null, stdout: "", stderr: "", ms: Date.now() - started, operation_id: opId, image, error: "Sandbox run timed out while polling", cost: null };
}
