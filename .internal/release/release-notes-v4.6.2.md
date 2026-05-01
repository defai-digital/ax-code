# ax-code v4.6.2

This release improves autonomous mode reliability and cleans up internal repository structure.

## Highlights

- Autonomous mode now enforces todo completion at the runtime level — the session loop detects pending todos after each turn and continues until all are resolved, independent of model compliance with prompt instructions.
- Pending todos are injected into the system context at the start of every autonomous turn so the model always sees live task state, not just an upfront instruction.
- Internal planning workspace moved to `.internal/` for a cleaner top-level layout, keeping development-stage documents separate from the product-facing `docs/` surface.
- Homebrew tap push auth fixed — the release workflow now correctly uses the tap write token for all git operations, not just the clone step.

## Autonomous Mode

- **Runtime todo enforcement**: after the model ends a turn cleanly with pending todos, the session loop injects a continuation message and runs another turn. Capped at `session.max_todo_retries` (default 10) to prevent infinite loops when a todo is genuinely blocked.
- **Per-turn todo context**: a `<pending_todos>` block is added to the system prompt each turn in autonomous mode, giving the model live task state at the start of every reasoning cycle.
- **Configurable cap**: add `session.max_todo_retries` to `ax-code.json` to tune or disable the retry limit.

## Reliability

- Homebrew formula update script now exports `GH_TOKEN=TAP_TOKEN` for the entire script so `git push` uses tap write credentials, not the default read-only `github-actions[bot]` token that caused a 403 on v4.6.1.
- OpenRouter `HTTP-Referer` header updated to the correct repository URL.
- Shadow worktree app-data path corrected from the old brand path to `dre/shadow/<planId>`.
- Repository structure check now allows the `.tmp` root directory created by Bun install tooling.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@4.6.2`
- npm source package: `npm install -g @defai.digital/ax-code-source@4.6.2`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
