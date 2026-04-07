# SmartLLM Routing

SmartLLM adds an intelligent fallback layer to ax-code's agent routing. When enabled, messages that don't clearly match a specialist agent via keyword detection are classified by a lightweight LLM call, improving routing accuracy for ambiguous or natural-language requests.

By default, SmartLLM is **off**. Keyword-based routing handles the majority of cases with zero latency.

## Quick Start

Toggle from the TUI:

- Type `/smart-llm` in the prompt, or
- Press `Ctrl+P` and search "smart-llm", or
- Click the **SmartLLM On/Off** indicator in the status bar

The status bar shows the current state:

- **SmartLLM On** (purple text) — LLM classification fallback is active
- **SmartLLM Off** (white text) — keyword-only routing (default)

The setting persists across sessions in `ax-code.json`.

## How It Works

Agent routing uses a two-tier system:

### Tier 1: Keyword Routing (always active, <1ms)

Every user message is matched against keyword and regex patterns for each specialist agent (security, architect, debug, perf, devops, test). If a high-confidence match is found (confidence >= 0.5), the agent switches immediately. This handles ~80% of routing decisions with zero added latency.

### Tier 2: LLM Classification (SmartLLM only, ~200-500ms)

When keyword routing returns low confidence or no match on a substantial message (>30 characters), SmartLLM sends the message to a fast/cheap model for intent classification. The model classifies the message into one of the specialist agents or "none" (stay on current agent).

- Requires a small/flash model from your configured provider — classification is skipped entirely if no small model is available, avoiding unexpected cost from the full model
- Structured output with a constrained enum and confidence score — low-confidence classifications (below 0.3) are discarded automatically
- 3-second timeout — if the LLM is slow or unavailable, falls back to keyword result
- All errors caught silently — never blocks the user

## What SmartLLM Helps With

| Scenario | Without SmartLLM | With SmartLLM |
|---|---|---|
| "this function is sluggish and needs attention" | No route (no keyword match) | Routes to **perf** agent |
| "the login page takes forever to load" | No route | Routes to **perf** agent |
| "make sure the auth flow can't be bypassed" | No route | Routes to **security** agent |
| "we need better quality gates before merging" | No route | Routes to **test** agent |
| "scan for vulnerabilities" | Routes to **security** (keyword) | Same — keyword handles it |

SmartLLM is most valuable when users describe problems in natural language rather than using technical keywords.

## Drawbacks and Considerations

### Latency

SmartLLM adds **200-500ms** to messages that trigger the fallback path. High-confidence keyword matches (the common case) are unaffected — they return in <1ms regardless of the SmartLLM setting.

### Requires a Small Model

SmartLLM requires a small/flash model from your configured provider (e.g., Gemini Flash, GLM Flash, Grok Fast). If your provider has no small model available, or the provider is unreachable (offline, API key expired), the LLM fallback silently degrades to keyword-only routing. The full model is never used for classification to avoid unexpected costs.

### Token Usage

Each classification call consumes approximately **100-200 input tokens** and **10-20 output tokens**. With typical flash/mini model pricing, this costs roughly **$0.00002 per classification** — negligible compared to the main LLM call that follows. However, users on strict token budgets should be aware that SmartLLM adds a small per-message overhead on the fallback path.

### Not a Replacement for Explicit Selection

SmartLLM improves automatic routing but is not perfect. For critical tasks where the right specialist matters, explicitly selecting the agent via the agent picker or `@agent` mention is always more reliable than automatic classification.

## Configuration

### Toggle from the TUI

Use `/smart-llm` or the command palette (`Ctrl+P` -> "Turn smart LLM on/off"). The change takes effect immediately and is saved to your project's `ax-code.json`.

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

## SmartLLM + Other Settings

| Setting | Interaction |
|---|---|
| **Autonomous Mode** | SmartLLM works independently. Agent routing happens before permission checks. |
| **Sandbox Mode** | No interaction. SmartLLM only affects which agent is selected, not what the agent can do. |
| **Agent Tier** | SmartLLM routes to specialist agents only. Core agents (Dev, Planner, Reasoner) are not routing targets — switch to them manually. |

## When to Enable SmartLLM

**Enable if:**

- You frequently describe tasks in natural language rather than using technical keywords
- You work across multiple domains (security, testing, devops) in the same session
- You want the most accurate automatic agent selection

**Keep disabled if:**

- You prefer zero-latency routing and don't mind manually selecting agents
- You work offline or with unreliable network
- You want to minimize token usage
