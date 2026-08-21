# Verified Multi-Model Changes

Status: Active
Scope: current-state
Last reviewed: 2026-08-21
Owner: AX Code runtime

A workflow page for the job "I have a consequential change, I want more than one attempt at it, and I want the repository's own checks to decide which attempt is worth keeping."

For the mode reference — flags, configuration keys, ranking inputs — see [Execution Modes](modes.md). This page is the end-to-end task.

## When this is worth it

Running several models costs several times as much as running one. It pays off when the change is consequential and the failure is expensive to discover later: a refactor across module boundaries, a migration, a fix in security-sensitive code, or a change where you genuinely do not know which approach is right.

It is not worth it for a one-line edit, a rename, or anything you could verify by reading.

## Two different tools

| Tool      | What it produces                        | Writes files?              |
| --------- | --------------------------------------- | -------------------------- |
| `council` | independent review opinions, aggregated | No                         |
| `arena`   | candidate implementations, ranked       | Only in isolated worktrees |

Use `council` to decide **what** to do — it fans a design or review question out to several connected providers and aggregates the answers into consensus, strict-majority, minority, and singleton findings, with optional anonymous debate rounds. It is advisory. Agreement among models is not proof of correctness; it is a signal about how contested the question is.

Use `arena` to decide **which implementation** to keep.

## The arena implement workflow

### 1. Prepare

Implement mode requires a Git project with at least one commit and a **clean primary worktree**. Contestant worktrees are created from an exact base commit and cannot inherit uncommitted changes, so commit or stash first.

You also need at least two distinct connected providers, and `modes.arena.enabled: true`.

### 2. Run

```
/arena <task description>
```

Each contestant gets its own Git worktree created from the recorded base commit, and an implement agent runs in it. Your primary working tree is not modified by contestants.

### 3. What AX Code does with each candidate

- Snapshots the contestant's tracked **and untracked** changes into a durable branch commit, including any commits the agent made itself.
- Runs detected project verification commands — typecheck, test, lint — but only after a non-empty patch is captured. An empty patch cannot win.
- Ranks **verify-first** by default: only completed, non-empty patches that pass verification are eligible to win. Among passing candidates it prefers lower risk and more diverse patches.

### 4. Decide

The report gives you worktree paths, branch names, and commit ranges.

**AX Code does not merge the winner.** Inspect, merge, or cherry-pick yourself. That is deliberate: verification means "your configured checks passed on this patch," which is a real signal but not a substitute for review.

### 5. Review and, if needed, reverse

Once a candidate is in your tree, the evidence commands apply as normal:

```bash
ax-code graph <sessionID>       # what the winning run actually did
ax-code risk <sessionID>        # heuristic risk signals for the change
ax-code rollback <sessionID> --dry-run
```

See [Execution Evidence](execution-evidence.md).

## What "verified" means here, precisely

It means: the project's detected typecheck, lint, and test commands ran against that candidate's patch, and they passed.

It does not mean the change is correct, complete, secure, or well-designed. If your test suite does not cover the changed behavior, a passing candidate proves only that nothing already covered broke. Verification raises the floor; it does not certify the ceiling.

It also does not extend to ordinary interactive editing. Arena candidates and gated refactor application run checks; a normal `edit` or `write` in a regular session does not automatically. Run `verify_project` when you want that evidence recorded for an ordinary run.

## Cost and failure modes

- **Cost scales with contestants.** Each runs a full implement agent.
- **A dirty worktree stops the run** before anything else happens, by design.
- **Fewer than two providers** makes the comparison meaningless, and the tool reports rather than inventing a ranking.
- **All candidates can fail verification.** That is a useful result: it usually means the task was underspecified or the repository's checks are stricter than the agents assumed.

## Related

- [Execution Modes](modes.md) — full reference for council, arena, and the other modes
- [Execution Evidence](execution-evidence.md) — reviewing and reversing the result
- [Why AX Code](../why-ax-code.md) — why verification-first ranking is the wedge
- [Multi-Model Routing Best Practices](multi-model-routing.md) — splitting premium and support work
