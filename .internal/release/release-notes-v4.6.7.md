# ax-code v4.6.7

This release introduces automatic reasoning-depth promotion for models that support extended thinking, applying deeper reasoning in autonomous mode, plan sessions, and prompts that combine planning and risk signals.

## Highlights

- **Automatic reasoning promotion** — `ReasoningPolicy` inspects the active model's capabilities, the agent name, and the latest user message to decide whether to use a deeper reasoning variant (`high` or `medium`). Promotion fires in autonomous mode, when the `plan` agent is active, or when the prompt scores on both a planning keyword and a risk keyword simultaneously. Explicit user variants and per-agent `reasoningEffort`/`thinking` overrides are always respected and suppress auto-promotion.
- **Checkpoint system reminder** — when a deep-reasoning decision is made, a structured `<reasoning_policy>` block is appended to the system prompt asking the model to produce a concise decision checkpoint (objective, evidence, assumptions, chosen plan, risk, validation) before tool-heavy work begins.

## Session / LLM

- **`ReasoningPolicy` namespace** (`src/session/reasoning-policy.ts`):
  - `decide(input)` — returns a `Decision` with `depth` (`"standard"` | `"deep"`), `reason` (`"plan_mode"` | `"autonomous_mode"` | `"planning_risk_signal"`), `options` (merged into the model call), and `checkpoint` flag.
  - `options(input)` — convenience wrapper returning just the options delta.
  - `systemReminder(decision)` — returns the `<reasoning_policy>` XML block when `depth === "deep"` and `checkpoint === true`, otherwise `undefined`.
  - `usableVariant` prefers `variants.high`, falls back to `variants.medium`, skips any variant with `disabled: true`.
  - `hasExplicitReasoning` detects pre-existing `reasoning`, `reasoningEffort`, `reasoning_effort`, `thinking`, or `thinkingConfig` keys in model/agent/provider options and suppresses auto-promotion when found.
  - `latestUserText` extracts the text content of the most recent user message (handles string, array, and object content shapes).
- **`LLM.stream` wiring** (`src/session/llm.ts`): `ReasoningPolicy.decide` is called once per stream invocation; its `options` are merged after the base options stack (model → agent → variant), and `systemReminder` output is appended to the system prompt array when non-null.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@4.6.7`
- npm source package: `npm install -g @defai.digital/ax-code-source@4.6.7`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
