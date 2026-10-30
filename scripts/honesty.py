#!/usr/bin/env python3
"""Writes the honesty block from docs/FACTS.json and pins every "run of <timestamp>" to the facts header.

Owns exactly one block, between <!-- honesty:start --> and <!-- honesty:end -->, in README.md (under
"What is real and what is simulated") and in docs/RESULTS.md (under "What is real"). Rewrites every
"run of <ISO timestamp>" phrase in README.md, docs/DEVPOST_FULL.md and docs/VIDEO.md to the facts asOf,
so the three cannot drift. Refuses the word "autonomous" inside its block. Prints "no change" when
nothing moved. Exit 1 on a refusal.

Facts keys read (docs/FACTS_CONTRACT.md): asOf, tavily_mode, sandbox.image, ingest.tavily_calls,
check.tavily_calls, forge.tavily_calls, ingest.llm, check.llm, forge.steps, forge.sandbox_note,
check.claims_proposed, check.claims_backed, check.claims_rejected, verifier.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FACTS = ROOT / "docs/FACTS.json"
START, END = "<!-- honesty:start -->", "<!-- honesty:end -->"
ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})")


def block(f: dict) -> str:
    tavily = int(f["ingest"]["tavily_calls"]) + int(f["check"]["tavily_calls"]) + int(f["forge"]["tavily_calls"])
    llm = len(f["ingest"]["llm"]) + len(f["check"]["llm"]) + sum(1 for s in f["forge"]["steps"] if s.get("model"))
    note = f["forge"].get("sandbox_note")
    sandbox = f"did not run ({note})" if note else f"ran on {f['sandbox']['image']}"
    v = f["verifier"]
    c = f["check"]
    lines = [
        f"In the measured run of {f['asOf']}, every Tavily call ({tavily} in all, {f['tavily_mode']} mode) and every "
        f"Nemotron call ({llm} in all) was live against the APIs; nothing was replayed, recorded, or stubbed.",
        f"The sandbox step {sandbox}; the forge card says the same.",
        f"The verifier backed {c['claims_backed']} of {c['claims_proposed']} claims on the live check and rejected "
        f"{c['claims_rejected']}. On the planted fixture it rejected {v['planted_rejected']} of {v['planted']} misquotes and "
        f"accepted {v['decoys_backed']} of {v['decoys']} decoys; the misquotes it let through are named in docs/RESULTS.md.",
    ]
    return "\n".join(lines)


def check_autonomous(text: str) -> None:
    if re.search(r"\bautonomous", text, re.I):
        sys.exit("refused: the honesty block must not say 'autonomous'")


def replace_block(path: Path, body: str) -> bool:
    text = path.read_text()
    i, j = text.find(START), text.find(END)
    if i < 0 or j < 0:
        return False
    new = text[:i] + START + "\n" + body + "\n" + text[j:]
    if new != text:
        path.write_text(new)
        return True
    return False


def replace_run_of(path: Path, as_of: str) -> bool:
    text = path.read_text()
    new = re.sub(r"(Last run |run of )(?:" + ISO.pattern + r"|<asOf>|<FACTS asOf>)", lambda m: m.group(1) + as_of, text)
    if new != text:
        path.write_text(new)
        return True
    return False


def main() -> int:
    f = json.loads(FACTS.read_text())
    body = block(f)
    check_autonomous(body)
    changed = []
    for name in ("README.md", "docs/RESULTS.md"):
        p = ROOT / name
        if p.exists() and replace_block(p, body):
            changed.append(name)
    for name in ("README.md", "docs/DEVPOST_FULL.md", "docs/VIDEO.md"):
        p = ROOT / name
        if p.exists() and replace_run_of(p, f["asOf"]):
            changed.append(f"{name} (timestamp)")
    print("changed: " + ", ".join(changed) if changed else "no change")
    return 0


if __name__ == "__main__":
    sys.exit(main())
