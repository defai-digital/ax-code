# Protocol Steps — cli-cmd-github

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit root: `packages/ax-code/src/cli/cmd/github.ts`
Baseline commit: `cab6c0089e3b7b3410f050bc9d824c06a3c3a814`

## Step 1 Scope and map

The unit root `packages/ax-code/src/cli/cmd/github.ts:1` is a single-line selective barrel:

```ts
export { extractResponseText, formatPromptTooLargeError, GithubCommand, parseGitHubRemote } from "./github-agent/index"
```

It surfaces exactly four symbols out of the larger `github-agent/index.ts` surface. The real implementation lives in `packages/ax-code/src/cli/cmd/github-agent/` (`index.ts`, `types.ts`, `run.ts`, `install.ts`, `pr.ts`, `git-ops.ts`, `github-api.ts`, `prompts.ts`). `GithubCommand` is defined at `github-agent/index.ts:15-20` via the `cmd()` helper from `cli/cmd/cmd.ts:5`; `parseGitHubRemote`, `extractResponseText`, `formatPromptTooLargeError` are defined at `github-agent/types.ts:157`, `:163`, `:170`. No other statement exists in the unit file.

## Step 2 Threat and failure model

The barrel itself performs no I/O, spawns no process, reads no env, and touches no secrets — it is a pure static module re-export, consistent with the `cli` risk tag in MODULE-AUDIT. The only failure mode attributable to this file is a broken export binding (a re-exported name disappearing upstream), which `tsgo` would catch at typecheck time. The richer threat surface (token handling, `git` invocation, GitHub API calls) lives inside `github-agent/*` and belongs to other units, not to `cli-cmd-github`.

## Step 3 Correctness of the exported contract

I verified each of the four re-exported names resolves to a real upstream export:

- `GithubCommand` → `github-agent/index.ts:15` (const, `cmd({...})`).
- `parseGitHubRemote` → re-exported at `github-agent/index.ts:5`, defined at `types.ts:157`.
- `extractResponseText` → re-exported at `github-agent/index.ts:5`, defined at `types.ts:163`.
- `formatPromptTooLargeError` → re-exported at `github-agent/index.ts:5`, defined at `types.ts:170`.

External consumers resolved by import graph: `packages/ax-code/src/cli/boot.ts:22` imports `GithubCommand` from `./cmd/github` and registers it in the command array at `boot.ts:91`. The three helper re-exports are consumed only by tests through this barrel (`test/cli/github-remote.test.ts:2`, `test/cli/github-action.test.ts:2`); production code calls them directly from `./types` (`github-agent/run.ts:35`, `github-agent/install.ts:13`). All four bindings are live; no dangling export.

## Step 4 Performance and load characteristics

`boot.ts:22` uses a static `import { GithubCommand }`, so evaluating `cli/cmd/github.ts` eagerly pulls the entire `github-agent` dependency graph (including `run.ts`, `install.ts`, `github-api.ts`, `prompts.ts`) into the CLI startup path for every invocation, even `ax-code --version`. Contrast the sibling `packages/ax-code/src/cli/cmd/pr.ts:13`, which defers the heavy `PrCommand` handler behind `await import("./github-agent/pr")`. The eager path is not on a hot loop so the cost is minor, but it is a real asymmetry versus `pr.ts`. Impact is LOW; a lazy `await import("./github-agent/index")` inside the `GithubCommand.handler` (currently an empty `async handler() {}` at `index.ts:19`) would align the two commands.

## Step 5 Design and ownership boundaries

The barrel is intentionally narrow: `github-agent/index.ts` also exports `formatGitHubAgentToolTitle`, `formatGitHubAgentFailureMessage`, `formatGitHubAgentPermissionCheckFailureMessage`, `formatGitHubAgentExistingPrCheckWarning`, `parseGitHubRunContextText` (`index.ts:8-13`), the `checkTruncation` function (`types.ts:105`), constants (`AGENT_USERNAME`, `WORKFLOW_FILE`, etc.), and many types — none of which `github.ts` re-exports. That narrowness is defensible (public CLI surface vs internal module API), but import discipline is inconsistent: `test/cli/github-agent-run-context.test.ts:8` imports `parseGitHubRunContextText` directly from `github-agent/index`, bypassing the barrel, while `github-action.test.ts:2` and `github-remote.test.ts:2` go through it. A documented rule (barrel = public, `github-agent/index` = internal) would make the boundary enforceable.

## Step 6 Dead code and hygiene

The unit file is one line with no dead branches, no `TODO`, no `FIXME`, no empty `catch`, no commented-out code — matching the MODULE-AUDIT inventory (0 TODOs, 0 empty catches). Formatting matches the repo Prettier config (`semi: false`). No action required.

## Step 7 Tests

Coverage of the three pure helpers is solid and exercised _through this barrel_:

- `packages/ax-code/test/cli/github-remote.test.ts:5-79` — 30+ `parseGitHubRemote` assertions across https/ssh/git@ protocols, `.git` suffix variants, dot-in-name repos, and negative cases (gitlab, bitbucket, bare strings, tree/blob URLs).
- `packages/ax-code/test/cli/github-action.test.ts:82-191` — `extractResponseText` (last-text-wins via `findLast`, null on non-text, throw on `[]` per `types.ts:167`) and `formatPromptTooLargeError` (empty-files branch and KB-rounding branch).

`GithubCommand` itself (yargs `builder`/`demandCommand` wiring at `index.ts:15-20`) has no direct unit test; it is covered indirectly by CLI boot wiring and e2e. That gap is acceptable for a declarative yargs module but is the weakest-covered export.

## Step 8 Findings register

No Critical or High severity findings. The MODULE-AUDIT register ("none accepted") stands. Two LOW informational notes from this pass:

1. **Eager graph load** — static `boot.ts:22` import pulls the full `github-agent` graph at startup; `pr.ts:13` shows the lazy alternative. Optional optimization only.
2. **Selective-barrel import discipline** — tests split between the barrel and direct `github-agent/index` imports; documenting the boundary would help. Neither warrants a blocking disposition.

## Step 9 Verification and exit

Evidence for sign-off: importer graph confirmed via ripgrep over `packages/ax-code/src` and `packages/ax-code/test` (consumers: `src/cli/boot.ts:22,91`; `test/cli/github-remote.test.ts:2`; `test/cli/github-action.test.ts:2`; direct `github-agent` consumers at `src/cli/cmd/pr.ts:13`, `run.ts:35`, `install.ts:13`). All four re-exported bindings resolve to real definitions in `github-agent/index.ts` / `types.ts`. Recommended gate command for the implementer: `pnpm --dir packages/ax-code run typecheck` (tsgo, recursive) plus `pnpm --dir packages/ax-code run test:unit -- github-remote github-action` to cover the barrel's pure helpers. No Critical items exist, so no `reverify.md` cross-lane confirmation is required for this unit.
