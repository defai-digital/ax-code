# Model Effort (Thinking / Variants)

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-18  
Owner: ax-code runtime

AX Code uses **effort** (also called thinking level) to control how hard the active model reasons. Effort is **not** a work mode and is **not** a placement mode.

| Axis | Question | Examples |
| ---- | -------- | -------- |
| **Model** | Which model? | Sonnet, Opus, GPT, local Qwen |
| **Effort** | How hard should it think? | Auto, Fast, Balanced, Deep, Max |
| **Work mode** | How is the job structured? | Agent, Council, Arena |
| **Placement** | Where does inference run? | local, cloud, hybrid |

See [Execution Modes](modes.md) for work and placement modes.

## Wire format

The runtime still stores and sends OpenCode-compatible **variant** keys from the provider catalog (for example `low`, `medium`, `high`, `xhigh`, `max`). UI labels are a presentation layer only:

| UI label | Typical wire key |
| -------- | ---------------- |
| Auto | _(none — model / policy default)_ |
| Off | `none` |
| Minimal | `minimal` |
| Fast | `low` |
| Balanced | `medium` |
| Deep | `high` |
| Max | `xhigh`, `max` |

Available keys are **per model**. Models with no variants hide the effort control.

## Provider support

Effort levels are generated automatically for supported models on these providers:

| Provider | Mechanism | Levels |
| -------- | --------- | ------ |
| Anthropic (Claude) | `effort` on current models; thinking budgets on legacy models | Fast, Balanced, Deep, Max (model-dependent) |
| OpenAI (GPT-5.x) | `reasoningEffort` | Fast, Balanced, Deep |
| xAI (Grok) | Responses API `reasoningEffort` | Fast, Balanced, Deep |
| Google (Gemini 3.x) | `thinkingConfig.thinkingLevel` | Fast, Deep (3.1 adds Balanced) |
| OpenAI-compatible endpoints | `reasoningEffort` | Fast, Balanced, Deep |
| Venice | `reasoningEffort` | Fast, Balanced, Deep |
| Claude Code CLI | `--effort` | Fast, Balanced, Deep, Max |
| Codex CLI | `model_reasoning_effort` config override | Minimal, Fast, Balanced, Deep, Max |
| Grok Build CLI | `--reasoning-effort` | Fast, Balanced, Deep |

Providers whose effort API is unverified or incompatible (Groq's hosted API, OpenRouter, DeepSeek/Alibaba/MiniMax/GLM/Mistral families, unsupported CLI providers, and third-party gateways) expose **no** built-in levels; `/effort` explains this instead of failing silently. Define custom levels under `provider.<id>.models.<model>.variants` in `ax-code.json` when a provider documents a supported option shape.

## How to set effort

### TUI

- **Cycle:** `ctrl+t` (keybind `variant_cycle`) — walks Auto → each available level → Auto
- **Picker:** `/effort` (aliases `/variant`, `/thinking`); on models without levels it opens an explanation dialog
- **Status:** prompt footer shows the current effort chip when the model supports levels; sent messages show their effort label in the metadata row
- **CLI:** `ax-code run --variant high`

### Desktop

- Thinking control next to the model picker
- Keyboard cycle (same keybind path as model variant cycle)
- Labels use the same friendly mapping as the TUI

## Defaults and auto behavior

1. **Auto** means no explicit user override for that model.
2. When Auto is active, [ReasoningPolicy](../packages/ax-code/src/control-plane/reasoning-policy.ts) applies a **balanced** baseline (`medium` / provider `default` variant) so models actually enable thinking / pass effort flags instead of omitting them.
3. This applies both to models with `reasoning: true` and to providers that only expose effort as variants (for example Claude Code / Codex / Grok Build CLIs, which report `reasoning: false` because output is opaque to the AI SDK).
4. Policy may still **raise** depth to Deep for plan mode, autonomous mode, or high-risk prompts (and for repeated failure / high uncertainty / high blast radius when those signals are supplied).
5. When the user picks an explicit effort, that override wins for subsequent turns (policy does not fight it). Config or agent options that already set reasoning/`effort`/`thinking` are also left alone.
6. Effort is remembered **per model** in local model preferences (`model.json` in the TUI state dir).

## Configuration

Pin a default on an agent:

```json
{
  "agent": {
    "plan": {
      "variant": "high"
    }
  }
}
```

Define or disable provider variants under `provider.<id>.models.<model>.variants` in `ax-code.json` (same shape as OpenCode).

## Best practices

- Prefer **Auto** or **Balanced/Deep** for daily work; reserve **Max** for hard debugging or architecture.
- Do not invent a fourth global “lite / xfast / max” **mode** that competes with Agent/Council/Arena.
- Keep model, effort, and work mode as separate controls in UI copy.
- On model switch, invalid stored effort falls back to Auto for that model.

## Related

- [Execution Modes](modes.md) — Agent / Council / Arena and hybrid placement
- [Supported Providers](supported-providers.md) — which providers expose models
- OpenCode model variants: https://opencode.ai/docs/models/
