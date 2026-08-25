# Execution Evidence

Status: Active
Scope: current-state
Last reviewed: 2026-08-25
Owner: AX Code runtime

Every AX Code session is recorded while it runs. This page covers the commands that turn that recording into something you can review, compare, export, and undo.

Use it when an agent has finished and you need to answer: what did it do, how risky was it, how did it compare with another attempt, and how do I get back?

## What gets recorded

During a run AX Code writes two independent things:

- **A typed event log** — routing decisions, model activity, step boundaries, tool calls, and tool results. This is the source for `graph`, `replay`, `compare`, `trace`, and `audit`.
- **File snapshots** — captured into a Git object store that lives **outside your repository**, under the AX Code data directory, using `refs/snapshots/<hash>`. Your working tree and your project's `.git/` are not modified to store them.

Both are local. Nothing is uploaded.

## Reconstruct a run

```bash
ax-code graph <sessionID>
```

Rebuilds the session as an execution graph: duration, risk summary, token counts, agents used, and every step with its tool calls and timings.

```console
## Session ses_01H8XK

Duration: 9m 54s | Risk: HIGH (53/100) | Tokens: 167,650 in / 18,494 out
Agents: architect

### Step 1 (8s) | tokens: 12263/587

- read: api.ts → ok (5ms)
- grep: rateLimit → ok (12ms)
```

`--format` selects alternative outputs, including Mermaid and a topology view, when you want the graph in another tool.

Note that this is the **session execution graph** — what the agent did. It is not the repository code graph; that is `ax-code index` and the code-intelligence layer.

## Compare two runs

```bash
ax-code compare <sessionA> <sessionB>
ax-code compare <sessionA> <sessionB> --deep
```

Reports the risk delta, files changed, tool-failure counts, the decision path each run took, and per-event-type counts. `--deep` adds step-level divergence analysis through replay comparison.

This compares **runs**, not source code. It answers "the second attempt scored worse — where did it diverge," not "show me the code diff."

A typical use is deciding between two strategies for the same task:

```console
  Risk Comparison
  ----------------------------------------
  Score: 53 → 93 (+40) ↑
  Level: HIGH → CRITICAL
  Files: 8 → 25
  Failures: 0 → 15
```

## Inspect the recorded event log

```bash
ax-code replay <sessionID> --mode summary
ax-code replay <sessionID> --mode verify
ax-code replay <sessionID> --mode reconstruct
ax-code replay <sessionID> --mode export
```

`verify` checks the recorded log for consistency. `reconstruct` rebuilds the step stream from events. `export` writes a portable replay package.

**Replay reconstructs; it does not re-execute.** It does not re-run models, re-invoke tools, or reproduce external state. The `execute` mode prepares a reconstructed stream for programmatic comparison against the original and is intended for testing, not for re-running work.

## Read the risk signals

```bash
ax-code risk <sessionID>
ax-code risk <sessionID> --explain
ax-code risk <sessionID> --json
```

The score is a **deterministic heuristic** derived from recorded signals, including how many files changed, whether the change spans multiple top-level areas, how many tool calls failed, whether validation ran, whether a diff snapshot exists, how much API surface is affected, how the run ended (a blocked completion gate or a step-limit/stalled finish both add weight), and whether security-sensitive paths were touched. Each contributing driver is listed with its weight, along with suggested mitigations.

It is a review aid. It is not a probability, a calibrated confidence, or a statement that the code is secure. A LOW score on an unverified change still means the change is unverified.

## Undo precisely

```bash
ax-code rollback <sessionID> --list      # show recoverable points
ax-code rollback <sessionID> --dry-run   # show what would change
ax-code rollback <sessionID> --step 4    # restore one step
ax-code rollback <sessionID>             # restore the whole session
```

`--list` combines durable step events with execution-graph detail, so you can target a specific step rather than reverting the entire run. `--dry-run` uses the same rollback planner as apply and lists any delegated sessions whose file ledger contributes to the result.

Rollback follows nested child sessions when they wrote to the parent's exact working directory. It restores their post-boundary file changes while retaining their transcripts. Descendants running in another worktree or directory are excluded, and rollback fails closed if any included session is still running.

**Boundaries worth knowing before you rely on it:** rollback restores from snapshots taken during the run. A file that was never snapshotted — because it was changed outside the session, or was not in a recoverable state — cannot be restored this way. Use `--dry-run` first on anything consequential.

## Try a different strategy

```bash
ax-code branch <sessionID>
ax-code branch <sessionID> --from <messageID>
```

Forks the session's stored state so a second attempt starts from a chosen point instead of from scratch.

This forks **session state** — messages and goals. It is not a Git branch and not a worktree. For isolated Git candidates, see [Verified Multi-Model Changes](verified-multi-model-change.md).

## Diagnose

```bash
ax-code trace <sessionID>
ax-code trace <sessionID> --logs
```

Replay-backed diagnostics with a risk-scored timeline. `--logs` switches to legacy log-file analysis instead of replay events, which is useful when you are investigating an operational problem rather than reviewing a change.

## Export the evidence

```bash
ax-code audit export --all --since 2026-08-01     # JSON Lines
ax-code audit export --all --risk HIGH            # filter by minimum risk
ax-code audit report <sessionID>                  # Markdown report
ax-code audit otlp <sessionID>                    # OpenTelemetry spans
ax-code audit prune --days 90                     # delete old events
```

JSONL and OTLP make the run record consumable by your own review or observability pipeline. The Markdown report is meant for humans attaching evidence to a PR or a change record.

## Browse it

```bash
ax-code dre-graph                 # latest session
ax-code dre-graph --index         # session index
```

Opens a local browser dashboard with the run summary, timeline, changes, validation state, risk detail, branch information, and rollback points. The server binds to loopback only.

## Related

- [Why AX Code](../why-ax-code.md) — what this evidence layer is for
- [Verified Multi-Model Changes](verified-multi-model-change.md) — producing candidates worth comparing
- [Semantic Layer](../architecture/semantic-layer.md) — provenance envelopes on graph and LSP answers
- [Web Dashboard](dashboard.md) — the workspace-level view
