"use client";

// Rule Forge presentation: the live stepper while the agent works, the
// settled timeline of steps, list rows, and the dark code block.

import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ClipboardChecklistIcon, CodeIcon, PlayIcon, SearchIcon, WrenchIcon, XIcon } from "@shopify/polaris-icons";
import NextLink from "next/link";
import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/client";
import type { ForgeRow, ForgeStep } from "@/lib/db";
import { cx, hostOf, StatusPill, type Tone } from "@/components/stitch";

export const STAGES: Array<{ kind: ForgeStep["kind"]; label: string; live: string }> = [
  { kind: "sources", label: "Sources", live: "Tavily is reading the official pages" },
  { kind: "write", label: "Write", live: "Nemotron 3 Ultra is writing check.py" },
  { kind: "tests", label: "Tests", live: "Nemotron 3 Nano is writing test_check.py" },
  { kind: "run", label: "Run", live: "Running the tests in a Token Factory sandbox" },
  { kind: "revise", label: "Revise", live: "Nemotron 3 Ultra is revising check.py from the failures" },
];

export function forgeTone(status: ForgeRow["status"]): Tone {
  if (status === "passed") return "success";
  if (status === "failed") return "critical";
  return "neutral";
}

export function forgeLabel(status: ForgeRow["status"]): string {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  return "Not run";
}

export function ForgeStatusPill({ status }: { status: ForgeRow["status"] }) {
  return (
    <StatusPill tone={forgeTone(status)} dot={status !== "unrun"}>
      {forgeLabel(status)}
    </StatusPill>
  );
}

// fact_name arrives as an identifier (de_minimis_suspension_date); show it as words.
export function prettyFact(name: string | null | undefined): string {
  if (!name) return "Check";
  const words = name.replace(/[_\-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function fmtCost(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `$${v.toFixed(4)}`;
}

export function shortImage(image: string | null | undefined): string {
  if (!image) return "sandbox";
  const tail = image.split("/").pop() ?? image;
  return tail.replace(/^tag:/, "");
}

export interface TestResult {
  name: string;
  ok: boolean;
  error?: string;
}

export function parseRun(step: ForgeStep): { passed: number | null; failed: number | null; tests: TestResult[]; headline: string } {
  const lines = step.detail.split("\n");
  const m = lines[0]?.match(/^(\d+) passed, (\d+) failed/);
  const tests: TestResult[] = [];
  for (const line of lines.slice(1)) {
    const t = line.match(/^(PASS|FAIL) (\S+?)(?::\s*(.*))?$/);
    if (t) tests.push({ name: t[2], ok: t[1] === "PASS", error: t[3] || undefined });
  }
  return { passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null, tests, headline: lines[0] ?? "" };
}

export interface FoundFact {
  found: boolean;
  value: string | null;
  quote: string | null;
  source_url: string | null;
  fact: string | null;
  error: string | null;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function factFrom(forge: ForgeRow): FoundFact | null {
  const out = forge.last_output?.output;
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  return { found: Boolean(o.found), value: str(o.value), quote: str(o.quote), source_url: str(o.source_url), fact: str(o.fact), error: typeof o.error === "string" ? o.error : null };
}

// Advance the fake stepper on a timer while the request runs. The marks are
// seconds from the start and follow how long each stage usually takes.
export function useForgeStageTimer(running: boolean): number {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!running) {
      setStage(0);
      return;
    }
    const marks = [0, 6, 28, 40, 58];
    const start = Date.now();
    setStage(0);
    const id = setInterval(() => {
      const s = (Date.now() - start) / 1000;
      let i = 0;
      for (let k = 0; k < marks.length; k++) if (s >= marks[k]) i = k;
      setStage(i);
    }, 500);
    return () => clearInterval(id);
  }, [running]);
  return stage;
}

type StepState = "done" | "active" | "pending" | "failed" | "skipped";

function settledStates(forge: ForgeRow): StepState[] {
  const kinds = new Set(forge.steps.map((s) => s.kind));
  const lastRun = [...forge.steps].reverse().find((s) => s.kind === "run");
  return STAGES.map((s) => {
    if (!kinds.has(s.kind)) return "skipped";
    if (s.kind === "run") return forge.status === "passed" ? "done" : forge.status === "unrun" ? "skipped" : lastRun?.ok ? "done" : "failed";
    return "done";
  });
}

export function ForgeStepper({ stage, settled, compact }: { stage?: number; settled?: ForgeRow | null; compact?: boolean }) {
  const states: StepState[] = settled ? settledStates(settled) : STAGES.map((_, i) => (i < (stage ?? 0) ? "done" : i === (stage ?? 0) ? "active" : "pending"));
  const line = settled
    ? settled.status === "passed"
      ? `Tests passed after ${settled.iterations} iteration${settled.iterations === 1 ? "" : "s"}.`
      : settled.status === "failed"
        ? `Tests still failing after ${settled.iterations} iteration${settled.iterations === 1 ? "" : "s"}.`
        : "Code and tests written. The sandbox run was skipped."
    : STAGES[stage ?? 0].live;
  return (
    <div className="sr-stack sr-stack--tight" aria-live="polite">
      <div className="sr-stepper">
        {STAGES.map((s, i) => (
          <div key={s.kind} className={cx("sr-step", `sr-step--${states[i]}`)}>
            <span className="sr-step__dot">{states[i] === "done" ? <CheckIcon /> : states[i] === "failed" ? <XIcon /> : i + 1}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      {!compact ? (
        <p className="sr-xs" style={{ textAlign: "center" }}>
          {line}
        </p>
      ) : null}
    </div>
  );
}

export function ForgeListRow({ forge }: { forge: ForgeRow }) {
  return (
    <NextLink href={`/forge/${forge.id}`} className="sr-prow" style={{ padding: "10px 0" }}>
      <div className="sr-grow sr-stack" style={{ gap: 3 }}>
        <div className="sr-row" style={{ gap: 8 }}>
          <ForgeStatusPill status={forge.status} />
          <span className="sr-body sr-truncate" style={{ fontWeight: 600 }}>
            {prettyFact(forge.fact_name)}
          </span>
        </div>
        <span className="sr-xs sr-truncate">{forge.rule_title}</span>
        <span className="sr-xs sr-num sr-truncate">
          {forge.iterations} iteration{forge.iterations === 1 ? "" : "s"}, {shortImage(forge.sandbox_image)}, {fmtCost(forge.llm_cost_usd)}, {fmtDuration(forge.duration_ms)}, {timeAgo(forge.created_at)}
        </span>
      </div>
      <span className="sr-audit__icon" style={{ color: "var(--sr-text-2)", fill: "var(--sr-text-2)" }} aria-hidden>
        <ChevronRightIcon />
      </span>
    </NextLink>
  );
}

export function CodeBlock({ title, code, compact }: { title: string; code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  const lines = code.split("\n").length;
  return (
    <div className={cx("sr-code", compact && "sr-code--compact")}>
      <div className="sr-code__bar">
        <span>
          {title}, {lines} line{lines === 1 ? "" : "s"}
        </span>
        <button type="button" className="sr-code__copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ModelBadge({ model }: { model: ForgeStep["model"] }) {
  if (!model) return null;
  return <span className={cx("sr-model", `sr-model--${model}`)}>{model === "nano" ? "Nano" : model === "ultra" ? "Ultra" : "Super"}</span>;
}

const ICONS: Record<ForgeStep["kind"], typeof SearchIcon> = {
  sources: SearchIcon,
  write: CodeIcon,
  tests: ClipboardChecklistIcon,
  run: PlayIcon,
  revise: WrenchIcon,
};

function stepTone(s: ForgeStep): Tone {
  if (s.kind === "run") return s.ok ? "success" : "critical";
  if (s.kind === "write" || s.kind === "tests") return "info";
  if (s.kind === "revise") return "warning";
  return "neutral";
}

export function ForgeTimeline({ steps }: { steps: ForgeStep[] }) {
  if (steps.length === 0) return <p className="sr-sm">No steps were recorded.</p>;
  return (
    <div className="sr-timeline">
      {steps.map((s, i) => {
        const Icon = ICONS[s.kind] ?? CodeIcon;
        const tone = stepTone(s);
        const run = s.kind === "run" ? parseRun(s) : null;
        const output = s.output as Record<string, unknown> | undefined;
        return (
          <div key={i} className="sr-tl">
            <span className={cx("sr-tl__icon", tone !== "neutral" && `sr-tl__icon--${tone === "warning" ? "info" : tone}`)} aria-hidden>
              <Icon />
            </span>
            <div className="sr-tl__body">
              <div className="sr-row sr-row--between sr-row--top" style={{ gap: 8 }}>
                <div className="sr-row sr-row--wrap" style={{ gap: 6 }}>
                  <span className="sr-body" style={{ fontWeight: 600 }}>
                    {s.title}
                  </span>
                  <ModelBadge model={s.model} />
                </div>
                {s.ms != null ? <span className="sr-xs sr-num sr-right">{fmtDuration(s.ms)}</span> : null}
              </div>
              {run ? (
                <>
                  {run.headline && run.tests.length ? <p className="sr-xs sr-num">{run.headline}</p> : run.headline ? <p className="sr-pre">{s.detail}</p> : null}
                  {run.tests.length ? (
                    <div className="sr-tests">
                      {run.tests.map((t) => (
                        <div key={t.name} className="sr-test">
                          <StatusPill tone={t.ok ? "success" : "critical"}>{t.ok ? "Pass" : "Fail"}</StatusPill>
                          <div style={{ minWidth: 0 }}>
                            <div className="sr-test__name">{t.name}</div>
                            {t.error ? <div className="sr-test__error">{t.error}</div> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {output && "found" in output ? (
                    <p className="sr-xs sr-num">
                      check() returned found {String(output.found)}
                      {output.value != null ? `, value ${String(output.value)}` : ""}
                    </p>
                  ) : null}
                </>
              ) : s.kind === "sources" ? (
                <div className="sr-stack" style={{ gap: 2 }}>
                  {s.detail
                    .split("\n")
                    .filter(Boolean)
                    .map((u) => (
                      <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="sr-link sr-truncate" style={{ fontSize: 12, display: "block" }}>
                        {hostOf(u) ?? u}
                        {safePath(u)}
                      </a>
                    ))}
                </div>
              ) : (
                <p className="sr-pre">{s.detail}</p>
              )}
              {s.code ? (
                <details className="sr-disclosure sr-disclosure--inline">
                  <summary>
                    <span>{s.kind === "tests" ? "Show test_check.py" : "Show check.py"}</span>
                    <ChevronDownIcon />
                  </summary>
                  <div style={{ paddingTop: 8 }}>
                    <CodeBlock compact title={s.kind === "tests" ? "test_check.py" : "check.py"} code={s.code} />
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function safePath(u: string): string {
  try {
    const p = new URL(u).pathname;
    return p.length > 1 ? (p.length > 48 ? `${p.slice(0, 48)}...` : p) : "";
  } catch {
    return "";
  }
}
