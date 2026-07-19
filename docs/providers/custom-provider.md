# Custom and Gateway Providers

Status: Active
Scope: current-state
Last reviewed: 2026-06-09
Owner: ax-code runtime

AX Code talks to models through standard provider protocols. Any endpoint that speaks an **OpenAI-compatible** (`/v1/chat/completions`) or **Anthropic-compatible** (`/v1/messages`) API can be added as a custom provider by pointing `baseURL` at it — no code changes and no waiting for a built-in preset.

This covers self-hosted aggregators and relay gateways such as LiteLLM, one-api, new-api, and the Vercel AI Gateway, as well as private corporate proxies and any other compatible service. AX Code treats these uniformly: it speaks the wire protocol, you supply the URL and key.

> **Responsibility note.** A gateway sits between AX Code and the upstream model, so your prompts, code, and credentials pass through it. When you point AX Code at a third-party or account-pooling relay, you are responsible for trusting that operator with your data and for staying within the terms of service of every upstream provider it routes to. Built-in gateway presets such as OpenRouter use the same standard protocol path; custom gateway configuration does not imply endorsement of any relay operator.

## How a provider is resolved

For each request AX Code needs three things from a provider entry:

- **`npm`** — the AI SDK adapter that speaks the wire protocol. Use `@ai-sdk/openai-compatible` for OpenAI-style endpoints and `@ai-sdk/anthropic` for Anthropic-style endpoints. Only `@ai-sdk/*` adapters are bundled/installable.
- **`options.baseURL`** — the gateway URL. Falls back to the provider `api` field, then to the model's own `api.url`. Supports `${ENV_VAR}` substitution.
- **A credential** — resolved in order from `options.apiKey`, then the persisted auth store, then the provider's `env` variables.

Custom providers also need an explicit **`models`** map: unlike the built-in registry, AX Code does not know which models a private endpoint exposes, so you declare them.

## OpenAI-compatible gateway

Most aggregators (LiteLLM, one-api, new-api, free/self-hosted gateways) expose an OpenAI-compatible surface. Add this to your `ax-code.json` (global at `~/.config/ax-code/ax-code.json`, or per-project at the repo root):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
  "provider": {
    "my-gateway": {
      "name": "My Gateway",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKey": "${MY_GATEWAY_API_KEY}",
      },
      "models": {
        "gpt-4o": {
          "name": "GPT-4o (via gateway)",
          "tool_call": true,
          "reasoning": false,
          "attachment": true,
          "limit": { "context": 128000, "output": 16384 },
        },
      },
    },
  },
}
```

- The key `"my-gateway"` is the provider id you select in `/connect` and `ax-code models`.
- Each key under `models` must be the **exact model id the gateway expects** in the request body.
- Prefer `${ENV_VAR}` over a literal key so the secret stays out of committed config.

## Anthropic-compatible gateway

Relays that expose `/v1/messages` (the Claude API shape) use the Anthropic adapter:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
  "provider": {
    "my-claude-gateway": {
      "name": "My Claude Gateway",
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "https://gateway.example.com",
        "apiKey": "${MY_GATEWAY_API_KEY}",
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet (via gateway)",
          "tool_call": true,
          "reasoning": true,
          "attachment": true,
          "limit": { "context": 200000, "output": 64000 },
        },
      },
    },
  },
}
```

Some Anthropic-shaped relays also honor the Claude environment variables directly. For a quick headless run without editing config you can set:

```sh
export ANTHROPIC_BASE_URL="https://gateway.example.com"
export ANTHROPIC_AUTH_TOKEN="sk-..."
```

A config entry is still recommended when you want the gateway to appear as its own selectable provider with a curated model list.

## Model fields

Model entries reuse the registry schema; for a custom endpoint the useful fields are:

| Field        | Meaning                                                             |
| ------------ | ------------------------------------------------------------------- |
| `name`       | Display label in the model picker                                   |
| `tool_call`  | Whether the model supports tool/function calling (needed for tools) |
| `reasoning`  | Whether the model emits extended reasoning                          |
| `attachment` | Whether the model accepts image/file attachments                    |
| `limit`      | `{ context, output }` token limits used for budgeting               |
| `modalities` | Optional `{ input, output }` arrays (`text`, `image`, `pdf`, ...)   |

Set capability flags to match what the upstream model actually supports; AX Code uses them to gate tool calls, attachments, and context budgeting.

## Verifying

After saving config:

- `ax-code models` lists every model your provider exposes.
- `/connect` inside the TUI shows the provider and lets you authenticate if you used an `env` key instead of `options.apiKey`.

If a model is missing, confirm the provider id, the model key, and that the gateway is reachable at `baseURL`.

## Troubleshooting

- **Auth errors** — confirm the credential resolution order: `options.apiKey` wins, otherwise an `env`/auth-store key is used.
- **Stalled streams** — gateways sometimes buffer SSE. Tune `options.chunkTimeout` (per-chunk) and `options.timeout` (whole request) on the provider.
- **Tool calls rejected** — set `"tool_call": true` on the model and confirm the upstream model behind the gateway actually supports tools.
