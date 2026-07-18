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

## How to set effort

### TUI

- **Cycle:** `ctrl+t` (keybind `variant_cycle`) — walks Auto → each available level → Auto
- **Picker:** `/effort` (aliases `/variant`, `/thinking`)
- **Status:** prompt footer shows the current effort chip when the model supports levels
- **CLI:** `ax-code run --variant high`

### Desktop

- Thinking control next to the model picker
- Keyboard cycle (same keybind path as model variant cycle)
- Labels use the same friendly mapping as the TUI

## Defaults and auto behavior

1. **Auto** means no explicit user override for that model.
2. When Auto is active, [ReasoningPolicy](../packages/ax-code/src/control-plane/reasoning-policy.ts) may still raise depth for plan/autonomous/high-risk prompts.
3. When the user picks an explicit effort, that override wins for subsequent turns (policy does not fight it).
4. Effort is remembered **per model** in local model preferences (`model.json` in the TUI state dir).

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
