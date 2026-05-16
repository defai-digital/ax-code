# Auto-Route

Status: Active
Scope: current-state
Last reviewed: 2026-05-03
Owner: ax-code runtime

Auto-route controls two independent routing behaviors in ax-code:

1. **Keyword routing** — active by default. Switches the agent when a message matches a specialist's keywords or patterns. Fires in under 1ms and requires no LLM call. It is skipped when routing is explicitly disabled, the user explicitly names an agent, or the message is a synthetic continuation that preserves the current agent.

2. **Complexity routing** — optional, enabled by the auto-route toggle. A lightweight LLM call classifies each message as `low`, `medium`, or `high` complexity. `low`-complexity messages are automatically served by the provider's small/fast model, reducing latency for simple questions.

By default, auto-route is **off** — complexity routing is disabled. Keyword routing is separate from this toggle and remains active by default unless disabled by config or bypassed by an explicit agent choice.

## Quick Start

Toggle from the TUI:

- Type `/smart-llm` in the prompt, or
- Press `Ctrl+P` and search "auto-route", or
- Click the **Auto-route On/Off** indicator in the status bar

The status bar shows the current state:

- **Auto-route On** (purple text) — complexity routing is active
- **Auto-route Off** (white text) — complexity routing disabled (default)

The setting persists across sessions in `ax-code.json`.

## How It Works

### Source of Truth

This page summarizes user-facing behavior. When behavior changes, verify the docs against:

- `packages/ax-code/src/agent/router.ts` for keyword routing rules and `classifyComplexity()`.
- `packages/ax-code/src/session/prompt.ts` for when keyword routing is skipped and when complexity classification runs.
- `packages/ax-code/src/server/routes/smart-llm.ts` for default, environment, config, and persistence behavior.
- `packages/ax-code/src/config/schema.ts` for routing config fields and deprecation notes.
- `packages/ax-code/src/cli/cmd/tui/app.tsx` for slash command names, aliases, labels, and status-bar actions.
- `packages/ax-code/test/agent/router.test.ts` and TUI sync tests for expected activation behavior.

Avoid describing keyword routing and fast-model complexity routing as one feature. They are intentionally separate.

### Keyword Routing (active by default, <1ms)

User messages are matched against keyword and regex patterns for each specialist agent (security, architect, debug, perf, devops, test). If a match scores ≥ 0.4 confidence, the agent can switch immediately — no LLM call is made. This path is independent of the auto-route toggle, but it is skipped when routing is disabled, the user explicitly names an agent, or the current turn is preserving an existing agent for synthetic continuation.

### Complexity Routing (auto-route only, ~200-500ms)

When auto-route is enabled, each message is sent to a fast/cheap model via `classifyComplexity()`. This LLM call returns a complexity estimate (`low` / `medium` / `high`):

- `low`-complexity messages use the provider's small/fast model automatically
- `medium` and `high` messages use the default model as usual
- Skipped if no small model is available from the current provider
- 1.5-second timeout — falls back silently if the LLM is slow or unavailable
- All errors are caught silently — never blocks the user

Complexity routing is independent of agent routing. It does not classify which specialist agent to use — that is handled entirely by keyword routing.

## What Auto-Route Helps With

| Scenario                                  | Without Auto-Route             | With Auto-Route                     |
| ----------------------------------------- | ------------------------------ | ----------------------------------- |
| "what does this variable do?"             | Full model used                | `low` complexity → fast model       |
| "list all exports in this file"           | Full model used                | `low` complexity → fast model       |
| "scan for vulnerabilities"                | Keyword routes to **security** | Same — keyword routing always fires |
| "refactor the auth module across 8 files" | Default model                  | `high` complexity → default model   |
| "this function is sluggish"               | No keyword match, no route     | `low`/`medium` → correct model tier |

Keyword routing handles specialist agent selection for technical keywords. Complexity routing selects the appropriate model tier based on how much reasoning the answer needs.

## Drawbacks and Considerations

### Latency

Complexity routing adds **200-500ms** to messages that trigger the classification call. Keyword routing (always active) is unaffected — it returns in <1ms regardless.

### Requires a Small Model

Complexity routing requires a small/flash model from the configured provider (e.g., Gemini Flash, GLM Flash, Grok Fast). If no small model is available, the classification is silently skipped and the default model is used.

### Token Usage

Each classification call uses approximately **100-200 input tokens** and **10-20 output tokens** — negligible compared to the main LLM call that follows.

### Not a Replacement for Explicit Selection

Auto-route improves automatic model tier selection but cannot route to specialist agents based on natural language alone. For critical tasks where the right specialist matters, explicitly selecting the agent via the agent picker or `@agent` mention is more reliable.

## Configuration

### Toggle from the TUI

Use `/smart-llm` or the command palette (`Ctrl+P` → "Turn auto-route on/off"). The change takes effect immediately and is saved to your project's `ax-code.json`.

### Config File

```json
{
  "routing": {
    "llm": true
  }
}
```

### Environment Variable

```bash
AX_CODE_SMART_LLM=true ax-code
```

The environment variable overrides the config file setting.

## Auto-Route + Other Settings

| Setting             | Interaction                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Autonomous Mode** | Auto-route works independently. Agent routing and complexity classification happen before permission checks.                    |
| **Sandbox Mode**    | No interaction. Auto-route only affects which agent and model tier is selected, not what the agent can do.                      |
| **Model Selection** | `low`-complexity messages use the provider's small model automatically when auto-route is on and no model is explicitly pinned. |

## When to Enable Auto-Route

**Enable if:**

- You want simple questions automatically routed to a cheaper, faster model
- You want to reduce token costs on low-complexity exchanges
- You work with a provider that has a reliable small/flash model

**Keep disabled if:**

- You prefer zero added latency on every message
- You work offline or with unreliable network
- You want to minimize token usage
- You always pin a model explicitly
