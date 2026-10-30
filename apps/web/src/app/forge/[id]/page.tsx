"use client";

import { Banner } from "@shopify/polaris";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import type { ForgeRow } from "@/lib/db";
import { AccentCard, BackLink, Chip, ChipRow, hostOf, MetricCard, Skeleton, SrButton, SrCard, StatusPill, StatusStrip } from "@/components/stitch";
import { CodeBlock, factFrom, fmtCost, fmtDuration, ForgeStatusPill, ForgeStepper, ForgeTimeline, forgeLabel, parseRun, prettyFact, shortImage } from "@/components/forge";

export default function ForgePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { data, loading, error } = useApi<{ forge: ForgeRow }>(id ? `/api/forges/${id}` : null);
  const [tab, setTab] = useState<"check" | "tests">("check");
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove() {
    if (!data || !confirm("Delete this check? The code and its step log are removed.")) return;
    try {
      await api(`/api/forges/${data.forge.id}`, { method: "DELETE" });
      router.push(`/products/${data.forge.product_id}`);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  if (error) {
    return (
      <div className="sr-page sr-page--narrow">
        <BackLink href="/products">Inspector</BackLink>
        <Banner tone="critical">
          <p>{error}</p>
        </Banner>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="sr-page">
        <BackLink href="/products">Inspector</BackLink>
        <Skeleton lines={2} />
        <Skeleton lines={5} />
      </div>
    );
  }

  const f = data.forge;
  const fact = factFrom(f);
  const runSteps = f.steps.filter((s) => s.kind === "run");
  const lastRun = runSteps.length ? parseRun(runSteps[runSteps.length - 1]) : null;
  const modelCalls = f.steps.filter((s) => s.model).length;
  const sourceDomain = fact?.source_url ? hostOf(fact.source_url) : null;

  return (
    <div className="sr-page">
      <BackLink href={`/products/${f.product_id}`}>Inspector</BackLink>
      {actionError ? (
        <Banner tone="critical" onDismiss={() => setActionError(null)}>
          <p>{actionError}</p>
        </Banner>
      ) : null}

      <StatusStrip title={`Rule Forge, ${forgeLabel(f.status)}`} subtitle={`${f.rule_title}, forged ${timeAgo(f.created_at)}`} right={<ForgeStatusPill status={f.status} />} />

      <SrCard className="sr-stack">
        <div className="sr-row sr-row--between sr-row--top" style={{ gap: 12 }}>
          <div className="sr-grow">
            <p className="sr-xs">Check as code</p>
            <h1 className="sr-h1" style={{ marginTop: 2 }}>
              {prettyFact(f.fact_name)}
            </h1>
            <p className="sr-sm" style={{ marginTop: 4 }}>
              {f.rule_title}
              {f.product_title ? `, ${f.product_title}` : ""}
            </p>
            {!/\s/.test(f.fact_name) ? (
              <p className="sr-xs sr-mono" style={{ marginTop: 4 }}>
                check() returns {f.fact_name}
              </p>
            ) : null}
          </div>
        </div>
        <ForgeStepper settled={f} compact />
        <div className="sr-metrics sr-metrics--4">
          <MetricCard label="Iterations" value={f.iterations} delta={f.status === "unrun" ? "run skipped" : `${runSteps.length} sandbox run${runSteps.length === 1 ? "" : "s"}`} />
          <MetricCard label="Duration" value={fmtDuration(f.duration_ms)} delta={`${modelCalls} model call${modelCalls === 1 ? "" : "s"}`} />
          <MetricCard label="Cost" value={fmtCost(f.llm_cost_usd)} delta={`${f.tavily_calls} source read${f.tavily_calls === 1 ? "" : "s"}`} />
          <MetricCard label="Sandbox" value={<span style={{ fontSize: 15 }}>{shortImage(f.sandbox_image)}</span>} delta="Token Factory" />
        </div>
      </SrCard>

      {f.status === "unrun" ? (
        <AccentCard tone="warning" className="sr-stack">
          <div className="sr-accent-head">
            <div className="sr-grow">
              <h2 className="sr-h2">Sandbox not configured</h2>
              <p className="sr-sm" style={{ marginTop: 4 }}>
                {f.sandbox_note ?? "The run was skipped."}
              </p>
            </div>
            <StatusPill tone="warning">Not run</StatusPill>
          </div>
          <p className="sr-xs">check.py and test_check.py were written and are shown below. Configure the sandbox and forge again to run the tests.</p>
        </AccentCard>
      ) : null}

      {fact ? (
        fact.found ? (
          <AccentCard tone="success" className="sr-stack">
            <div className="sr-row sr-row--between sr-row--top">
              <p className="sr-xs" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--sr-primary-pressed)" }}>
                The check found
              </p>
              {lastRun && lastRun.passed != null ? (
                <StatusPill tone={f.status === "passed" ? "success" : "critical"}>
                  {lastRun.passed} of {(lastRun.passed ?? 0) + (lastRun.failed ?? 0)} tests
                </StatusPill>
              ) : null}
            </div>
            <div className="sr-result-value">{fact.value ?? "a match"}</div>
            {fact.fact ? <p className="sr-body">{fact.fact}</p> : null}
            {fact.quote ? <blockquote className="sr-quote">{fact.quote}</blockquote> : null}
            {fact.source_url ? (
              <p className="sr-xs">
                Quoted from{" "}
                <a className="sr-link" href={fact.source_url} target="_blank" rel="noopener noreferrer">
                  {sourceDomain ?? fact.source_url}
                </a>
                . The quote is an exact substring of the page text, checked by the tests.
              </p>
            ) : null}
          </AccentCard>
        ) : (
          <AccentCard tone="warning" className="sr-stack">
            <h2 className="sr-h2">The check did not find the fact</h2>
            <p className="sr-sm">
              {fact.error ? fact.error : fact.fact ? `It looked for: ${fact.fact}.` : "Nothing matched in the sources on this run."}
              {f.status === "passed" ? " The tests still passed, so the check behaves as expected on these sources." : ""}
            </p>
          </AccentCard>
        )
      ) : null}

      <SrCard className="sr-stack">
        <div className="sr-row sr-row--between">
          <h2 className="sr-h2">How it was built</h2>
          <span className="sr-xs">
            {f.steps.length} step{f.steps.length === 1 ? "" : "s"}
          </span>
        </div>
        <ForgeTimeline steps={f.steps} sandboxNote={f.sandbox_note} />
      </SrCard>

      <SrCard className="sr-stack">
        <div className="sr-row sr-row--between sr-row--wrap">
          <h2 className="sr-h2">The code</h2>
          <ChipRow label="File">
            <Chip active={tab === "check"} onClick={() => setTab("check")}>
              check.py
            </Chip>
            <Chip active={tab === "tests"} onClick={() => setTab("tests")}>
              test_check.py
            </Chip>
          </ChipRow>
        </div>
        <CodeBlock title={tab === "check" ? "check.py" : "test_check.py"} code={tab === "check" ? f.code : f.tests} />
        <p className="sr-xs">check(sources) returns found, value, quote, source_url, and fact. Only re, json, datetime, and math are allowed, no network. A passing check can re-run on fresh page text without asking a model again.</p>
      </SrCard>

      <SrCard className="sr-stack">
        <h2 className="sr-h2">Sources the check reads</h2>
        {f.sources.length === 0 ? (
          <p className="sr-sm">No sources were recorded.</p>
        ) : (
          <div className="sr-rows">
            {f.sources.map((s) => (
              <div key={s.url} className="sr-stack" style={{ padding: "8px 0", gap: 2 }}>
                <span className="sr-xs" style={{ fontWeight: 600, color: "var(--sr-text)" }}>
                  {hostOf(s.url) ?? s.url}
                </span>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="sr-link" style={{ fontSize: 12, display: "block", wordBreak: "break-word" }}>
                  {s.title || s.url}
                </a>
              </div>
            ))}
          </div>
        )}
      </SrCard>

      <div style={{ textAlign: "center" }}>
        <SrButton variant="plain" className="sr-link--danger" onClick={remove}>
          Delete this check
        </SrButton>
      </div>
    </div>
  );
}
