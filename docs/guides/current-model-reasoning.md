# Current model reasoning controls

Status: Active

Scope: current-state

Last reviewed: 2026-09-14

Owner: ax-code runtime

AX Code selects reasoning controls using the upstream model ID and SDK protocol. These profiles cover OpenAI-compatible Chat routes for the exact IDs below. They preserve existing native SDK, private GPU, AX Engine and constrained gateway behavior.

| Model IDs                                                | Available effort                                        | Autonomous / repeated tool failure | Auxiliary requests           |
| -------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------- | ---------------------------- |
| `qwen3.8-max`, `qwen3.8-flash`                           | low, medium, xhigh; high is an existing alias for xhigh | xhigh                              | Thinking disabled            |
| `glm-5.3`                                                | low, high, max; deep aliases max                        | max                                | Low effort; thinking enabled |
| `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-flash` | low, high, max                                          | high; explicit xdeep selects max   | Thinking disabled            |
| `MiniMax-M3`                                             | Existing thinking / none switch; no effort levels       | Provider thinking default          | Thinking disabled            |
| `MiniMax-M2.7`                                           | No effort or disabling switch                           | Always-on thinking                 | Always-on thinking           |

Explicit model/agent reasoning options and selected variants override automatic effort policy. A negative reasoning capability declaration prevents automatic effort variants and these auxiliary controls. GLM and DeepSeek keep the provider's default when ordinary requests do not select an effort. Auxiliary requests use their own controls without changing the user's saved selection.

## Qwen option conflicts and forced tools

Qwen 3.8 accepts either `reasoning_effort` or `thinking_budget`, never both. An explicit thinking budget suppresses automatic effort selection. When merged options contain both an effort and a budget, effort wins. `high` and `max` normalize to `xhigh`, `minimal` to `low`, and `none` disables thinking. Alibaba plan routes retain their existing token-budget ceiling, including the bounded fallback when no effort is selected. These mappings follow the [Alibaba Chat API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions).

Qwen thinking mode rejects forced tool calls. For `tool_choice: required`, AX Code disables thinking for that request and removes incompatible effort, budget and preservation options. Subsequent automatic tool turns resume the selected effort. The existing DeepSeek required-tool handling also keeps thinking disabled for that request, as required by its [thinking-mode API](https://api-docs.deepseek.com/guides/thinking_mode/).

## Reasoning continuity

Qwen, GLM and DeepSeek replay stored reasoning through `reasoning_content`. MiniMax M2.7/M3 Chat requests use `reasoning_split: true` so the SDK receives reasoning separately and can replay it exactly. This avoids converting gateway reasoning into the `<mm:think>` format used by private GPU deployments. Explicit `reasoning_split: false` retains native `<think>` replay. Anthropic signatures and private GPU tag handling retain their existing paths. See [MiniMax's Chat API](https://platform.minimax.io/docs/api-reference/text-openai-api).

GLM's cross-turn preserved thinking remains opt-in through provider `options.preserveThinking: true` during eligible long-agent requests. It sends `thinking: { type: "enabled", clear_thinking: false }`. Enable it only for complete, unmodified history from the same model; it can increase billed input. Ordinary tool-turn replay does not require this opt-in. [Z.ai documents the preservation requirements](https://docs.z.ai/guides/capabilities/thinking-mode). GLM 5.3 always reasons, so auxiliary requests use low effort rather than disabling it. [GLM 5.3 controls](https://docs.z.ai/guides/llm/glm-5.3).

## Custom deployments

A gateway may expose the same model ID using a different parameter dialect. To retain the previous transform behavior for a model, set `options.nativeReasoning: false` on that model's provider configuration:

```json
{
  "provider": {
    "my-gateway": {
      "models": {
        "glm-5.3": {
          "options": { "nativeReasoning": false }
        }
      }
    }
  }
}
```

This is a local profile opt-out, not a command to disable model thinking. It is removed before sending the request. Existing explicitly configured variants remain user controls. The native DeepSeek SDK does not gain effort variants from this profile because its installed serializer does not support them.

API acceptance, tool continuation, and exact client replay are compatibility evidence. They do not prove that an upstream honors every effort hint, that its cache hits more often, or that coding quality or speed improves. Use the paired [harness evaluation](harness-controls.md) for task-level comparisons.
