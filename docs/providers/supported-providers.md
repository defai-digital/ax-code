# Supported Providers and Models

Status: Active
Scope: current-state
Last reviewed: 2026-07-26
Owner: ax-code runtime

This page lists the provider presets AX Code exposes in the default setup flows. The source of truth is the runtime provider allowlist in
`packages/ax-code/src/provider/default-setup-providers.ts`, the bundled model snapshot in
`packages/ax-code/src/provider/models-snapshot.json`, and the AX Engine definitions in
`packages/ax-code/src/provider/ax-engine/constants.ts`.

Use `/connect` in the terminal UI or `ax-code providers login <provider-id>` for interactive setup. Headless and CI environments can also provide the listed environment variables.

Hosted model catalogs are bundled with each AX Code release and filtered for usable coding-agent capabilities. Run
`ax-code models <provider-id>` for the authoritative model IDs in your installed release; the raw registry and copied
web lists can contain models AX Code hides because they lack text output or tool calling. A provider preset does not
imply that every model is free or available on every account.

## Cloud API Providers

These providers call hosted APIs or hosted account-plan endpoints.

| Provider id              | Display name                | Credential environment variables                                   |
| ------------------------ | --------------------------- | ------------------------------------------------------------------ |
| `google`                 | Google                      | `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_API_KEY` |
| `groq`                   | GroqCloud                   | `GROQ_API_KEY`                                                     |
| `openrouter`             | OpenRouter                  | `OPENROUTER_API_KEY`                                               |
| `huggingface`            | Hugging Face                | `HF_TOKEN`                                                         |
| `unorouter`              | UnoRouter                   | `UNOROUTER_API_KEY`                                                |
| `alibaba-coding-plan`    | Alibaba Coding Plan         | `ALIBABA_CODING_PLAN_INTL_API_KEY`, `ALIBABA_CODING_PLAN_API_KEY`  |
| `alibaba-coding-plan-cn` | Alibaba Coding Plan (China) | `ALIBABA_CODING_PLAN_CN_API_KEY`, `ALIBABA_CODING_PLAN_API_KEY`    |
| `alibaba-token-plan`     | Alibaba Token Plan          | `ALIBABA_TOKEN_PLAN_INTL_API_KEY`, `ALIBABA_TOKEN_PLAN_API_KEY`    |
| `alibaba-token-plan-cn`  | Alibaba Token Plan (China)  | `ALIBABA_TOKEN_PLAN_CN_API_KEY`, `ALIBABA_TOKEN_PLAN_API_KEY`      |
| `github-copilot`         | GitHub Copilot              | `GITHUB_TOKEN`                                                     |
| `zai-coding-plan`        | Z.AI Coding Plan            | `ZHIPU_API_KEY`                                                    |

> `huggingface` is the **hosted Serverless Inference Providers router** (`https://router.huggingface.co/v1`).
> It is unrelated to the local Hugging Face snapshot cache that AX Engine uses to store downloaded
> local models — connecting `huggingface` never starts or requires the local engine.

For a no-cost first run, see [Free-Tier API Quickstart](free-tier-apis.md). It distinguishes a provider's free
offering from AX Code's compatibility and explains why an external free-API catalog is not itself a support matrix.

The hosted `xai` provider remains available for explicit configuration or existing credentials, but it is hidden from the default setup list. For Grok, the default setup path is the `grok-build-cli` provider listed below.

`github-copilot` is the GitHub Copilot account bridge. It is not the separate `github-models` API listed by some
free-API directories.

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
| `kimi-cli`        | Kimi Code CLI            | `kimi`                 | `kimi-cli`         |

Run the vendor CLI login first when required, then run `ax-code providers login <provider-id>`. AX Code probes the CLI command and stores a local marker credential after the probe succeeds.

For Kimi Code membership, install the local `kimi` binary, run `kimi login`, then `ax-code providers login kimi-cli`. AX Code reuses the Kimi Code CLI session (`~/.kimi-code`, with legacy fallback to `~/.kimi`) rather than storing a hosted Moonshot API key.

## AX Engine Local Provider

`ax-engine` is the built-in local inference provider. It is available only on eligible Apple Silicon Macs and exposes curated AutomatosX AXQ 6-bit MLX packs. The 27B and 9B packs include an AXQuant MTP sidecar; the coding specialist is direct decode.

| Provider id | Model id                    | Display name                           | Context | Output |
| ----------- | --------------------------- | -------------------------------------- | ------: | -----: |
| `ax-engine` | `qwen3.6-27b-axq-6bit`      | Qwen3.6-27B AXQ 6-bit (Local MLX Auto) |  65,536 |  2,048 |
| `ax-engine` | `qwen3.5-9b-axq-6bit`       | Qwen3.5-9B AXQ 6-bit (Local MLX Auto)  |  32,768 |  2,048 |
| `ax-engine` | `qwen3-coder-next-axq-6bit` | Qwen3-Coder-Next AXQ 6-bit (Local MLX) |  16,384 |  2,048 |

The default local model is `qwen3.6-27b-axq-6bit`. See [AX Engine Model Selection](ax-engine-model-selection.md) for ranking, memory, and disk guidance.

For a configured local AX Engine server, `/v1/models` is authoritative: AX Code discovers the live model IDs, context/output limits, modalities, and structured tool-call support. A model that does not advertise structured tool calling is not used for coding-agent requests.

AX Engine uses the compact `core` tool profile by default (`bash`, file discovery/read/edit/write, and skills). Set `provider.ax-engine.options.toolProfile` to `full` only for a custom deployment with enough context for the complete tool registry.

### Installing the engine

Local inference needs AX Engine 6.11.0 or later. On Apple Silicon macOS install the Homebrew formula, which includes the matching MLX runtime:

```bash
brew install defai-digital/ax-engine/ax-engine
ax-engine doctor
```

AX Code then resolves the binary in this order:

1. `provider.ax-engine.options.binaryPath` in `ax-code.json`
2. the `AX_ENGINE_BIN` environment variable
3. `ax-engine` on your `PATH`
4. an existing AX Code-managed install from an older release

It first checks `--version` and falls back to the structured `doctor --json` install version used by the wrapper. AX Code owns server startup and normally launches `ax-engine serve` on `127.0.0.1:31418`; installing the formula does not require a separate Homebrew service.

The built-in managed downloader is temporarily disabled because the current raw release archive does not include its matching MLX dylibs and metallib. The Homebrew formula is the supported clean-Mac installation path. A future self-contained archive can re-enable the managed **Install** action without changing provider behavior.

Installing the engine does not download a model. Pick and download a model afterward from the Desktop **Models** page or with `ax-code providers ax-engine prepare`. A complete compatible base snapshot already in the Hugging Face cache is accepted for direct decode; `prepare --download` uses the catalog's preferred MTP package when available.

To use an already-running local server instead of AX Code-owned lifecycle, configure:

```json
{
  "provider": {
    "ax-engine": {
      "options": {
        "baseURL": "http://127.0.0.1:31418/v1"
      }
    }
  }
}
```

For development validation of a future self-contained build, set `AX_ENGINE_INSTALL_URL`, `AX_ENGINE_INSTALL_SHA256`, and `AX_ENGINE_INSTALL_VERSION` before starting AX Code.

The engine ships for Apple Silicon macOS only. On other hosts, use a hosted provider or an OpenAI-compatible provider gateway; AX Code servers are local-only.
