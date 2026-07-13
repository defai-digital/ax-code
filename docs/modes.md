# Execution Modes (Local, Cloud, Hybrid, Council, Arena)

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-12  
Owner: ax-code runtime

AX Code can place work on local inference, hosted/CLI providers, or both (hybrid), and can fan out high-stakes work across multiple connected providers (council review and arena best-of-N). This page documents **shipped** behavior for those modes.

## Source of Truth

When behavior changes, verify against:

- `packages/ax-code/src/mode/` — pure policy, hybrid, council aggregation, arena ranking, debate, budget, memory, worktree policy, implement-arena scoring
- `packages/ax-code/src/tool/council.ts` — multi-provider council tool
- `packages/ax-code/src/tool/arena.ts` and `arena-implement.ts` — plan and implement arena
- `packages/ax-code/src/session/prompt-routing.ts` — hybrid placement when `modes.default` is `hybrid`
- `packages/ax-code/src/config/schema-impl.ts` — `modes` config schema
- `packages/ax-code/src/command/template/{council,arena,mode}.txt` — `/council`, `/arena`, `/mode`

## Work mode selector (Agent | Council | Arena)

TUI and Desktop expose a **work mode** control (Qoder-style). Default is **Agent**.

| UI selection | Free-text send becomes |
|--------------|------------------------|
| **Agent** (default) | Normal single-agent prompt |
| **Council** | `/council {your message}` multi-provider review |
| **Arena** | `/arena {your message}` multi-model best-of-N |

- **Desktop:** composer toolbar → **Work mode** dropdown (next to Manual/Autonomous).
- **TUI:** prompt footer chip **Agent / Council / Arena** (click) or palette **Cycle work mode** / `/work-mode`.
- Explicit `/commands` are never rewritten.
- Specialist agents (architect, security, …) stay on the separate agent picker.

## Placement modes at a glance

| Mode | What it does | Mutates workspace? | Default |
|------|----------------|--------------------|---------|
| **local** | Prefer AX Engine (or configured local provider) | Yes (single agent) | When you pin local / hybrid places local |
| **cloud** | Prefer hosted or CLI frontier providers | Yes (single agent) | When local unavailable |
| **hybrid** | Policy chooses local vs cloud from availability + complexity + privacy | Yes (single path) | Set `modes.default: "hybrid"` |
| **council** | Fan out structured review/design; classify consensus / majority / singleton | **No** (advisory) | Tool + `/council` or Work mode = Council |
| **arena** | Multi-model plan comparison or worktree implement best-of-N | Plan: no. Implement: only in **worktrees** | Opt-in (`modes.arena.enabled`) + Work mode = Arena |

Keyword specialist routing and complexity tiering (see [Auto-Route](auto-route.md)) are **orthogonal** to hybrid placement and ensemble modes.

## Configuration

In `ax-code.json`:

```json
{
  "modes": {
    "default": "hybrid",
    "hybrid": {
      "preferLocalWhenAvailable": true,
      "escalateOnHighComplexity": true,
      "localProviderID": "ax-engine"
    },
    "council": {
      "enabled": true,
      "maxMembers": 3,
      "timeoutMs": 60000,
      "debateRounds": 0
    },
    "arena": {
      "enabled": true,
      "maxContestants": 3,
      "strategy": "verify_first"
    },
    "budget": {
      "maxEstimatedUsd": 0.5,
      "estimatedUsdPerMember": 0.05
    }
  }
}
```

| Field | Meaning |
|-------|---------|
| `modes.default` | `local` \| `cloud` \| `hybrid` \| `arena` \| `council`. Unset: hybrid when local fits the policy signals, else cloud for single-path defaults. |
| `modes.hybrid.*` | Local preference, high-complexity escalate to cloud, local provider id |
| `modes.council.*` | Enable, member cap, timeout, optional anonymous debate rounds |
| `modes.arena.enabled` | Must be `true` for the `arena` tool (default off). Mid-session edits are picked up on the next tool call (`Config.getFresh`). Or pass `enableIfDisabled: true` on the arena tool. |
| `modes.arena.strategy` | `verify_first` (recommended for implement), `diversity`, or `hybrid_score` |
| `modes.budget.*` | Fail-closed cap on estimated USD for ensemble fan-out |

## Hybrid placement

When `modes.default` is **`hybrid`** and the user/agent did not pin a model:

1. If local provider (default `ax-engine`) has a selectable model → prefer **local** for low/medium complexity.
2. If complexity is **high** and `escalateOnHighComplexity` is true → **cloud**.
3. If privacy requires local and local is available → **local**.
4. If local is unavailable → **cloud**.

Complexity still uses the existing small/fast model path for `low` messages when auto-route complexity routing is enabled ([Auto-Route](auto-route.md)). Hybrid does not replace keyword specialist routing.

Local models and memory guidance: [AX Engine Model Selection](ax-engine-model-selection.md). Providers list: [Supported Providers](supported-providers.md).

## Council (consensus mode)

**Tool:** `council`  
**Slash:** `/council <question>`

1. Selects diverse connected providers (family diversity; soft bias from outcome memory).
2. Fans out a structured review or design prompt in parallel.
3. Aggregates issues into **consensus** (all successful members), **majority**, and **singleton**.
4. Optional **debate rounds**: anonymous (Chatham House) synthesis shared between rounds; no brand attribution.
5. Returns an **advisory** markdown report. Does not edit files.

Needs at least two successful members for meaningful consensus tiers; otherwise the report is marked incomplete.

### When to use

- Architecture / security / design trade-offs
- High-stakes code review where multi-model agreement raises confidence
- User asks for a multi-model or “second opinion” review

### Agent workflow (important)

Call **`council` within the first 1–2 tool rounds** with a short `context` brief.  
Do **not** open `task_parallel` multi-explore digs first — that path is for parallel file research, not multi-provider ensemble, and often never reaches `council`.  
If the user asked for council/arena, `task_parallel` is rejected until the ensemble tool has been the intended primary action.

### When not to

- Trivial questions (latency/cost)
- Privacy-sensitive code that must not leave local inference
- Only one provider connected

## Arena (best-of-N)

**Tool:** `arena`  
**Slash:** `/arena <task>`  
**Requires:** `modes.arena.enabled: true` and ≥2 connected providers

### `mode: "plan"` (default)

- Each contestant proposes approach, steps, and risks (no workspace writes).
- Ranked with diversity / risk (not pure popularity).
- Advisory only.

### `mode: "implement"`

- Creates a **git worktree per contestant** (main workspace not modified by contestants).
- Runs an implement agent in each worktree.
- Runs project verification commands (typecheck / test / lint when detected).
- Ranks with **verify-first** by default: passers beat failers; among passers prefer lower risk and diverse patches.
- **Does not auto-merge.** Report includes worktree paths and branches for you to inspect and promote.

Implement arena requires a **git** project.

### Ranking rule (research-aligned)

For code candidates: **verification first, diversity second, popularity never alone.**  
Naive majority vote on similar wrong patches is an anti-pattern (popularity trap).

## Slash commands

| Command | Purpose |
|---------|---------|
| `/mode …` | Explain modes and how to configure them |
| `/council …` | Drive multi-provider advisory review |
| `/arena …` | Drive plan or implement best-of-N |

## Safety and cost

- **Sandbox / autonomous** still apply to single-agent work ([Sandbox](sandbox.md), [Autonomous](autonomous.md)).
- Council and plan-arena do not write files.
- Implement arena writers are isolated in worktrees; concurrent writers on the main tree remain rejected (same policy as parallel explore).
- Ensemble fan-out multiplies provider egress and cost; use `modes.budget` and keep `maxMembers` / `maxContestants` small.
- Multi-model agreement is **evidence, not proof** — run tests before shipping.

## Related

- [Auto-Route](auto-route.md) — specialist keywords + complexity tier
- [Supported Providers](supported-providers.md) — cloud, CLI, AX Engine
- [AX Engine Model Selection](ax-engine-model-selection.md) — local model choice
