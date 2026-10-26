# Choose and change models

Status: Active
Scope: current-state
Last reviewed: 2026-10-26
Owner: ax-code runtime

## Find a usable model

First [connect a provider](connect-provider.md). In the terminal UI, enter `/models`, search within the connected providers and select a model. Favorites and recent choices help you return to it.

The picker groups models by provider. Models without the required text output or tool-calling capabilities may be hidden or disabled. Managed local models can appear before their weights are downloaded; complete preparation before use.

For the IDs available to your installed CLI, run:

```sh
ax-code models
ax-code models --json --verbose
```

Copy the complete `provider/model` ID. The same display name through two providers can have different credentials, capabilities and limits.

## Select for one run

Replace the example value with an ID printed by your installation. The first command opens the terminal UI; the second runs one prompt. Keep the prompt after `--`.

```sh
MODEL='provider/model'
ax-code --model "$MODEL"
ax-code run --model "$MODEL" -- "Explain the project entry point without changing files."
```

The family aliases `deepseek`, `glm` and `qwen` select supported Flash models through available connections. Their targets can change between releases. Use a complete ID to request a specific model or tier; a bare SKU is not a complete ID.

## Save a default

Merge this field into your existing project or global `ax-code.json`; replace the placeholder instead of replacing the entire file:

```json
{
  "model": "provider/model"
}
```

Restart after editing configuration. Existing agent, session or recent choices can affect selection when no explicit model is supplied; check the active model before sending the task. Desktop maintains its own settings.

## Choose for the task

Start with a small repository question. For edits, verify tool calling and run your project checks. For images, confirm image input support. For long tasks, inspect context and output limits rather than relying on the model name.

Compare candidates on the same task, inputs and acceptance checks. Consider latency, provider usage terms, data handling and local memory needs. No model is guaranteed to produce a correct change.

Reasoning effort and [automatic routing](../guides/auto-route.md) are separate controls. Begin with one explicit model before enabling routing. Wiki generation can use its own `wiki.model` independently of the foreground session.

## If the model will not run

- Not listed: verify the provider is connected and enabled, then check capability filters and gateway discovery. Do not invent an ID from a marketing name.

- Unauthorized or forbidden: check the exact request model ID and account/key access. A successful login or listing does not prove permission to run it.

- Local preparation or memory error: finish downloading/loading the model and check its hardware requirements. Reduce workload or select a supported smaller model.

## Next steps

[Provider and model reference](../providers/supported-providers.md) · [Model recovery](../guides/model-recovery.md) · [AX Engine selection](../providers/ax-engine-model-selection.md) · [Wiki quickstart](wiki-quickstart.md) · [Documentation hub](../README.md)
