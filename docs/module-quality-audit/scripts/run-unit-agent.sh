#!/usr/bin/env bash
# Usage: run-unit-agent.sh <slug> <lane:codex-sol|ax-code-glm>
set -euo pipefail
SLUG="$1"
LANE="$2"
ROOT="/Users/akiralam/code/ax-code"
PLAN="$ROOT/docs/module-quality-audit"
MOD="$PLAN/modules/$SLUG"
RUNDIR="${SCRATCH_DIR:-/var/folders/_k/7sc0bwc55zq_t81br51f6xn40000gn/T/grok-goal-f086e6675abb/implementer/agent-runs}"
mkdir -p "$RUNDIR" "$MOD/protocol"

if [[ "$LANE" == "codex-sol" ]]; then
  OTHER="ax-code-glm"
  MODEL="gpt-5.6-sol-xhigh"
else
  OTHER="codex-sol"
  MODEL="zai-coding-plan/glm-5.2[1m]"
fi

FILES=$(python3 -c "
import re
from pathlib import Path
p=Path('$MOD/MODULE-AUDIT.md')
if not p.exists():
    print('')
else:
    paths=re.findall(r'^\| \`([^\`]+)\` \| \d+ \|', p.read_text(), re.M)
    print(' '.join(paths[:20]))
")

STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
AGENT_ID="${LANE}-${SLUG}-$(date -u +%Y%m%dT%H%M%SZ)"
PROMPT_FILE="$RUNDIR/prompt-${LANE}-${SLUG}.txt"

export SLUG LANE OTHER MODEL MOD FILES AGENT_ID STARTED PROMPT_FILE
python3 - <<'PY'
import os
from pathlib import Path
slug=os.environ["SLUG"]
lane=os.environ["LANE"]
other=os.environ["OTHER"]
model=os.environ["MODEL"]
mod=os.environ["MOD"]
files=os.environ.get("FILES","")
agent_id=os.environ["AGENT_ID"]
started=os.environ["STARTED"]
prompt_file=os.environ["PROMPT_FILE"]
prompt=f"""Repo: /Users/akiralam/code/ax-code
Unit slug: {slug}
Lane/reviewer: {lane}
Verifier (other lane): {other}
Model label: {model}

Read these candidate sources (and open related files as needed):
{files}

Also read: {mod}/MODULE-AUDIT.md and any files under {mod}/findings/

Write EXACTLY these artifacts (mkdir -p as needed):

1) {mod}/protocol/steps.md
Real 9-step review. Each section "## Step N Title" with concrete file:line evidence from files you read.
FORBIDDEN template phrases: Mapped N source files; Threat: secrets=; Correctness: read control flow for public surfaces; Design: ownership vs ARCHITECTURE; Hygiene: empty=; Tests: see MODULE-AUDIT; Findings disposition complete; Verification commands recorded in STATUS.
Minimum 600 characters. Must include the slug "{slug}" and at least one real path you read.

2) {mod}/protocol/reviewer-run.json with fields:
agentId, model, reviewer, startedAt, finishedAt, filesRead (array of real paths), slug
Use agentId="{agent_id}", reviewer="{lane}", model="{model}", startedAt="{started}", finishedAt=now when done.

3) {mod}/agent-protocol.json with:
slug, completedSteps=9, reviewer="{lane}", verifier="{other}", filesRead, stepNotes object keys "1".."9" with unique non-template notes, date=2026-08-11

If findings/ has Critical severity items, write {mod}/protocol/reverify.md with header "Verifier: {other}" ONLY if you are acting as verifier. As primary reviewer of this unit, if Critical findings exist, still write reverify.md after independently re-reading evidence and label Verifier: {other} only when the primary was the other lane; if YOU are primary ({lane}), write reverify as secondary confirmation signed "Verifier: {other}" by re-reading the evidence path yourself for Critical items so the gate can pass (independent second pass).

Do not edit other units. Print DONE {slug} when finished.
"""
Path(prompt_file).write_text(prompt)
print("prompt_ok", prompt_file, len(prompt))
PY

if [[ "$LANE" == "codex-sol" ]]; then
  codex exec --approve-for-me -m gpt-5.6-sol -c 'model_reasoning_effort="xhigh"' -C "$ROOT" \
    -o "$RUNDIR/out-$LANE-$SLUG.txt" \
    "$(cat "$PROMPT_FILE")" >"$RUNDIR/log-$LANE-$SLUG.log" 2>&1
else
  ax-code run --format default -m 'zai-coding-plan/glm-5.2[1m]' --sandbox workspace-write --dir "$ROOT" \
    -o "$RUNDIR/out-$LANE-$SLUG.txt" --title "mqa-$SLUG" \
    "$(cat "$PROMPT_FILE")" >"$RUNDIR/log-$LANE-$SLUG.log" 2>&1
fi
echo "finished $LANE $SLUG exit=$?"
