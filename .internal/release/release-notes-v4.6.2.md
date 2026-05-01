# ax-code v4.6.2

## v4.6.2 - autonomous todo enforcement and release pipeline fixes

This release improves autonomous-mode reliability, cleans up internal repository structure, and fixes the release pipeline issues that blocked earlier v4.6.x publishing attempts.

## Highlights

- Autonomous mode now enforces todo completion at runtime. If a turn ends cleanly while todos remain open, the session loop injects a continuation and keeps going until the todo list is complete or the configured retry cap is reached.
- Pending todos are injected into every autonomous turn via system context, so the model sees live task state instead of relying only on the original prompt.
- Internal planning and migration material moved out of public `docs/` into `.internal/`, while broken public doc links were repaired and the product-facing semantic layer doc was restored.
- Homebrew release publishing was repaired so tap pushes use the tap write token for the whole update script.
- Release workflow validation was fixed by removing secrets comparisons from job-level `if` conditions and simplifying Homebrew job gating.
- Source and compiled package publishing were verified for `latest`.

## Autonomous Mode

- Added runtime todo-completion enforcement with a configurable `session.max_todo_retries` cap.
- Added per-turn `<pending_todos>` context for autonomous sessions.
- Updated prompts so autonomous sessions treat unfinished todos as active work, not optional bookkeeping.

## Reliability And Runtime Fixes

- Fixed OpenRouter `HTTP-Referer` to point at the current repository.
- Corrected shadow worktree app-data paths from the old `automatosx/tmp/dre-shadow` location to `dre/shadow`.
- Allowed `.tmp` in the root structure check for Bun/tooling scratch state.
- Fixed `cliEnv` typing for dynamic key assignment in CLI-provider execution.
- Tightened bundled/source boot, MCP, bash, and read-tool handling shipped in the v4.6.2 release commit.

## Install Or Upgrade

```sh
npm install -g @defai.digital/ax-code@4.6.2
npm install -g @defai.digital/ax-code-source@4.6.2
brew upgrade ax-code || brew install defai-digital/ax-code/ax-code
brew upgrade ax-code-source || brew install defai-digital/ax-code/ax-code-source
```

## Verification

- GitHub Actions release run: https://github.com/defai-digital/ax-code/actions/runs/25233206034
- CI status: passed
- CI jobs passed: security scan, typecheck, deterministic tests, source publish, compiled builds, compiled backend stdio smoke, GitHub release, compiled npm publish, Homebrew, Homebrew source, finalize
- npm: `@defai.digital/ax-code@4.6.2` is on `latest`
- npm: `@defai.digital/ax-code-source@4.6.2` is on `latest`
- Release commit: `9517adadf2a31ee40eac7001ffe5f5052495f05f`

## Release Assets

| Asset | SHA256 |
| --- | --- |
| `ax-code-darwin-arm64.zip` | `20ea88f9a1e74cf12be5c29cd99dc68a9f3c27b4391ac4cc5c652a4dac933ccc` |
| `ax-code-linux-arm64-musl.tar.gz` | `da3cdb6afdc9d75b335d23037760aa5e75c656efe21073711140a6eb69168f1f` |
| `ax-code-linux-arm64.tar.gz` | `fe7b737f029e6adc79e1df6530fdb8dd577656ae4417fcd15121ba7919ab1a1d` |
| `ax-code-linux-x64-baseline-musl.tar.gz` | `d9aaa1da5bce6326fbfad7d30fcdad87fbd006f0de9de434d999f4d977c87c9b` |
| `ax-code-linux-x64-baseline.tar.gz` | `4c9dc2efd12133c015b9b387198cdfa0837a064f79f7ebed0500071aafd51137` |
| `ax-code-linux-x64-musl.tar.gz` | `3e616aa5e2615b629a57be9f263a3f321c57894743bddc3a119c736049451756` |
| `ax-code-linux-x64.tar.gz` | `d1fad90ab235cb0783ecfb6603bb290d793f2d9d9c3bcc117fe1587306686303` |
| `ax-code-windows-arm64.zip` | `e3e9b9046e5ab94b1c57d1cce798ec6b1c636953de39f055889f7ce50af9086d` |
| `ax-code-windows-x64.zip` | `a552fae0bc8666c0fe66359fcdc853b0516dc5011b8f965225faa237c823302f` |

**Full Changelog**: https://github.com/defai-digital/ax-code/compare/v4.6.1...v4.6.2
