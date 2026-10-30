"use client";

import { Button, TextField } from "@shopify/polaris";
import { useState } from "react";
import { api } from "@/lib/client";
import type { SkillRow } from "@/lib/db";
import { SrButton, StatusPill } from "@/components/stitch";

// Standing instructions written from dismissals. Each can be edited or deleted;
// the checker follows whatever is here on the next run.

const SCOPE_LABEL: Record<string, string> = { product: "This product", family: "This rule type", account: "Whole workspace" };

export function StandingInstructions({ skills, onChanged }: { skills: SkillRow[]; onChanged: (note: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/skills/${id}`, { method: "PATCH", json: { text: draft } });
      setEditing(null);
      onChanged("Instruction updated. The next check follows the new wording.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/skills/${id}`, { method: "DELETE" });
      onChanged("Instruction deleted. Future checks no longer follow it.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (skills.length === 0) return <p className="sr-sm">Dismiss an alert with a reason and Shop Rules writes it down here, then follows it on future checks.</p>;

  return (
    <div className="sr-rows">
      {error ? (
        <p className="sr-xs sr-tone-critical" role="alert">
          {error}
        </p>
      ) : null}
      {skills.map((s) => (
        <div key={s.id} className="sr-stack sr-stack--tight" style={{ padding: "10px 0" }}>
          <div className="sr-row sr-row--between" style={{ gap: 8 }}>
            <StatusPill caps={false}>{SCOPE_LABEL[s.scope] ?? s.scope}</StatusPill>
            <div className="sr-row" style={{ gap: 6 }}>
              {editing === s.id ? null : (
                <SrButton
                  variant="plain"
                  onClick={() => {
                    setEditing(s.id);
                    setDraft(s.text);
                  }}
                  disabled={busy != null}
                >
                  Edit
                </SrButton>
              )}
              <SrButton variant="plain" className="sr-link--danger" onClick={() => remove(s.id)} loading={busy === s.id && editing !== s.id} disabled={busy != null}>
                Delete
              </SrButton>
            </div>
          </div>
          {editing === s.id ? (
            <div className="sr-stack sr-stack--tight">
              <TextField label="Instruction" labelHidden value={draft} onChange={setDraft} autoComplete="off" multiline={2} maxLength={400} showCharacterCount />
              <div className="sr-row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <Button onClick={() => setEditing(null)} disabled={busy != null}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => save(s.id)} loading={busy === s.id} disabled={draft.trim().length < 6}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="sr-stack" style={{ gap: 2 }}>
              <p className="sr-body" style={{ color: "var(--sr-text)" }}>
                {s.text}
              </p>
              {s.rewrite && s.rewrite !== s.text ? <p className="sr-xs">In short: {s.rewrite}</p> : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
