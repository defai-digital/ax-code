# Supported Providers and Models

Status: Active
Scope: current-state
Last reviewed: 2026-06-28
Owner: ax-code runtime

This page lists the provider presets AX Code exposes in the default setup flows. The source of truth is the runtime provider allowlist in
`packages/ax-code/src/server/routes/provider.ts`, the CLI login allowlist in
`packages/ax-code/src/cli/cmd/providers-impl.ts`, the bundled model snapshot in
`packages/ax-code/src/provider/models-snapshot.json`, and the AX Engine definitions in
`packages/ax-code/src/provider/ax-engine/constants.ts`.

Use `/connect` in the terminal UI or `ax-code providers login <provider-id>` for interactive setup. Headless and CI environments can also provide the listed environment variables.

## Cloud API Providers

These providers call hosted APIs or hosted account-plan endpoints.

| Provider id              | Display name                | Credential environment variables                                   | Supported models                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google`                 | Google                      | `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_API_KEY` | `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemma-4-31b-it`, `gemini-embedding-001`, `gemini-3.1-pro-preview-customtools`, `gemini-flash-lite-latest`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`, `gemini-3.1-pro-preview`, `gemma-4-26b-a4b-it`, `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-flash-latest`, `gemini-3.1-flash-lite-preview` |
| `groq`                   | GroqCloud                   | `GROQ_API_KEY`                                                     | `qwen/qwen3.6-27b`, `openai/gpt-oss-120b`                                                                                                                                                                                                                                                                                                                                         |
| `openrouter`             | OpenRouter                  | `OPENROUTER_API_KEY`                                               | `openai/gpt-5.2-codex`, `openai/gpt-5.2`, `anthropic/claude-fable-5`, `anthropic/claude-sonnet-4.6`, `moonshotai/kimi-k2.7-code`, `qwen/qwen3-coder-plus`, `qwen/qwen3-coder-flash`, `google/gemini-3.5-flash`, `qwen/qwen3.7-plus`, `x-ai/grok-build-0.1`, `x-ai/grok-4.3`, `z-ai/glm-5.2`                                                                                       |
| `alibaba-coding-plan`    | Alibaba Coding Plan         | `ALIBABA_CODING_PLAN_INTL_API_KEY`, `ALIBABA_CODING_PLAN_API_KEY`  | `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `kimi-k2.7-code`, `qwen-image-2.0`, `qwen-image-2.0-pro`, `wan2.7-image`, `wan2.7-image-pro`                                                                                                                                                                              |
| `alibaba-coding-plan-cn` | Alibaba Coding Plan (China) | `ALIBABA_CODING_PLAN_CN_API_KEY`, `ALIBABA_CODING_PLAN_API_KEY`    | `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `kimi-k2.7-code`, `qwen-image-2.0`, `qwen-image-2.0-pro`, `wan2.7-image`, `wan2.7-image-pro`                                                                                                                                                                              |
| `alibaba-token-plan`     | Alibaba Token Plan          | `ALIBABA_TOKEN_PLAN_INTL_API_KEY`, `ALIBABA_TOKEN_PLAN_API_KEY`    | `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `kimi-k2.7-code`, `qwen-image-2.0`, `qwen-image-2.0-pro`, `wan2.7-image`, `wan2.7-image-pro`                                                                                                                                                                              |
| `alibaba-token-plan-cn`  | Alibaba Token Plan (China)  | `ALIBABA_TOKEN_PLAN_CN_API_KEY`, `ALIBABA_TOKEN_PLAN_API_KEY`      | `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `kimi-k2.7-code`, `qwen-image-2.0`, `qwen-image-2.0-pro`, `wan2.7-image`, `wan2.7-image-pro`                                                                                                                                                                              |
| `github-copilot`         | GitHub Copilot              | `GITHUB_TOKEN`                                                     | `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`, `gemini-3.5-flash`, `gpt-5.4-nano`, `claude-opus-4.7`, `gpt-5.2`, `gpt-5.3-codex`, `claude-opus-4.8`, `claude-fable-5`, `claude-opus-4.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-4.1`, `gemini-3.1-pro-preview`, `claude-sonnet-4.6`, `gpt-5-mini`, `gemini-3-flash-preview`, `claude-opus-4.6`, `gpt-5.2-codex`            |
| `zai-coding-plan`        | Z.AI Coding Plan            | `ZHIPU_API_KEY`                                                    | `glm-5.2`, `glm-5.2[1m]`                                                                                                                                                                                                                                                                                                                                                          |

The hosted `xai` provider remains available for explicit configuration or existing credentials, but it is hidden from the default setup list. For Grok, the default setup path is the `grok-build-cli` provider listed below.

OpenAI-compatible and Anthropic-compatible gateways are also supported through custom provider configuration. See [Custom and Gateway Providers](custom-provider.md).

## CLI Providers

CLI providers reuse a local vendor CLI and its login/session instead of storing a hosted API key in AX Code.

| Provider id       | Display name             | Required local command | Supported model id |
| ----------------- | ------------------------ | ---------------------- | ------------------ |
| `claude-code`     | Anthropic (Claude Code)  | `claude`               | `claude-code`      |
| `gemini-cli`      | Google (Gemini CLI)      | `gemini`               | `gemini-cli`       |
| `codex-cli`       | OpenAI (Codex CLI)       | `codex`                | `codex-cli`        |
| `grok-build-cli`  | Grok Build CLI           | `grok`                 | `grok-build-cli`   |
| `qoder-cli`       | Qoder CLI                | `qodercli`             | `qoder-cli`        |
| `antigravity-cli` | Google (Antigravity CLI) | `agy`                  | `antigravity-cli`  |

Run the vendor CLI login first when required, then run `ax-code providers login <provider-id>`. AX Code probes the CLI command and stores a local marker credential after the probe succeeds.

## AX Engine Local Provider

`ax-engine` is the built-in local inference provider. It is available only on eligible Apple Silicon Macs and exposes curated 6-bit MLX MTP models.

| Provider id | Model id           | Display name                          | Context | Output |
| ----------- | ------------------ | ------------------------------------- | ------: | -----: |
| `ax-engine` | `qwen3.6-27b-6bit` | Qwen3.6-27B 6-bit (Local MLX MTP)     |  32,768 | 16,384 |
| `ax-engine` | `qwen3.6-35b-a3b`  | Qwen3.6-35B-A3B 6-bit (Local MLX MTP) |  32,768 | 16,384 |
| `ax-engine` | `gemma-4-12b`      | Gemma 4 12B 6-bit (Local MLX MTP)     |  32,768 |  8,192 |
| `ax-engine` | `gemma-4-26b`      | Gemma 4 26B 6-bit (Local MLX MTP)     |  32,768 |  8,192 |
| `ax-engine` | `gemma-4-31b`      | Gemma 4 31B 6-bit (Local MLX MTP)     |  32,768 |  8,192 |
| `ax-engine` | `glm-4.7-flash`    | GLM 4.7 Flash 6-bit (Local MLX MTP)   |  32,768 |  8,192 |

The default local model is `qwen3.6-27b-6bit`. See [AX Engine Model Selection](ax-engine-model-selection.md) for ranking, memory, and disk guidance.
