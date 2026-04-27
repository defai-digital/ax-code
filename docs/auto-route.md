# Auto-Route

Auto-route adds an intelligent fallback layer to ax-code's agent routing. When enabled, messages that don't clearly match a specialist agent via keyword detection are classified by a lightweight LLM call — improving routing accuracy for ambiguous or natural-language requests and enabling complexity-based model selection.

By default, auto-route is **off**. Keyword-based routing handles the majority of cases with zero latency.

## Quick Start

Toggle from the TUI:

- Type `/smart-llm` in the prompt, or
- Press `Ctrl+P` and search "auto-route", or
- Click the **Auto-route On/Off** indicator in the status bar

The status bar shows the current state:

- **Auto-route On** (purple text) — LLM classification fallback is active
- **Auto-route Off** (white text) — keyword-only routing (default)

The setting persists across sessions in `ax-code.json`.

## How It Works

Agent routing uses a two-tier system:

### Tier 1: Keyword Routing (always active, <1ms)

Every user message is matched against keyword and regex patterns for each specialist agent (security, architect, debug, perf, devops, test, react, plan). If a high-confidence match is found (confidence ≥ 0.5), the agent switches immediately — no LLM call is made. This handles the majority of routing decisions with zero added latency.

### Tier 2: LLM Classification (auto-route only, ~200-500ms)

When keyword routing returns low confidence or no match on a substantial message (>30 characters), auto-route sends the message to a fast/cheap model via `analyzeMessage()`. This single LLM call returns **both** the agent classification and a complexity estimate (`low` / `medium` / `high`) in one pass.

- **Agent routing** — classifies into a specialist agent or "none" (stay on current)
- **Complexity routing** — `low`-complexity messages automatically use a fast/small model, reducing cost and latency for simple questions without manual intervention
- Requires a small/flash model from your configured provider — skipped if none is available
- Structured output with constrained enum and confidence score — low-confidence classifications (below 0.3) are discarded automatically
- 3-second timeout — falls back to keyword result if LLM is slow or unavailable
- All errors caught silently — never blocks the user

## What Auto-Route Helps With

| Scenario                                        | Without Auto-Route               | With Auto-Route               |
| ----------------------------------------------- | -------------------------------- | ----------------------------- |
| "this function is sluggish and needs attention" | No route (no keyword match)      | Routes to **perf** agent      |
| "the login page takes forever to load"          | No route                         | Routes to **perf** agent      |
| "make sure the auth flow can't be bypassed"     | No route                         | Routes to **security** agent  |
| "we need better quality gates before merging"   | No route                         | Routes to **test** agent      |
| "what does this variable do?"                   | Full model used                  | `low` complexity → fast model |
| "scan for vulnerabilities"                      | Routes to **security** (keyword) | Same — keyword handles it     |

Auto-route is most valuable when users describe problems in natural language rather than using technical keywords, and for routing simple questions to a cheaper model automatically.

## Drawbacks and Considerations

### Latency

Auto-route adds **200-500ms** to messages that trigger the fallback path. High-confidence keyword matches (the common case) are unaffected — they return in <1ms regardless of the auto-route setting.

### Requires a Small Model

Auto-route requires a small/flash model from your configured provider (e.g., Gemini Flash, GLM Flash, Grok Fast). If your provider has no small model available, or the provider is unreachable (offline, API key expired), the LLM fallback silently degrades to keyword-only routing. The full model is never used for classification to avoid unexpected costs.

### Token Usage

Each classification call consumes approximately **100-200 input tokens** and **10-20 output tokens**. With typical flash/mini model pricing, this costs roughly **$0.00002 per classification** — negligible compared to the main LLM call that follows. However, users on strict token budgets should be aware that auto-route adds a small per-message overhead on the fallback path.

### Not a Replacement for Explicit Selection

Auto-route improves automatic routing but is not perfect. For critical tasks where the right specialist matters, explicitly selecting the agent via the agent picker or `@agent` mention is always more reliable than automatic classification.

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

| Setting             | Interaction                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Autonomous Mode** | Auto-route works independently. Agent routing happens before permission checks.                                                      |
| **Sandbox Mode**    | No interaction. Auto-route only affects which agent and model tier is selected, not what the agent can do.                           |
| **Agent Tier**      | Auto-route routes to specialist agents only. Core agents (Dev, Planner, Reasoner) are not routing targets — switch to them manually. |
| **Model Selection** | `low`-complexity messages use the provider's small model automatically when auto-route is on and no model is explicitly set.         |

## When to Enable Auto-Route

**Enable if:**

- You frequently describe tasks in natural language rather than using technical keywords
- You work across multiple domains (security, testing, devops) in the same session
- You want the most accurate automatic agent selection
- You want simple questions automatically routed to a cheaper, faster model

**Keep disabled if:**

- You prefer zero-latency routing and don't mind manually selecting agents
- You work offline or with unreliable network
- You want to minimize token usage
