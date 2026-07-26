# Free-Tier API Quickstart

Status: Active
Scope: current-state
Last reviewed: 2026-07-26
Owner: ax-code runtime

AX Code does not provide model quota. A “free” run uses quota or credits offered by an external model provider, whose
availability, limits, data terms, and model catalog can change independently of AX Code.

## Shortest supported path: Groq

Groq is a default AX Code provider, its current AX Code model catalog contains tool-capable models, and Groq publishes
[Free Plan limits](https://console.groq.com/docs/rate-limits) for those model IDs.

1. Create a Groq account and API key in the [Groq Console](https://console.groq.com/keys).
2. Store the key in AX Code:

```bash
ax-code providers login groq
```

3. Confirm the models available in your installed AX Code release:

```bash
ax-code models groq
```

4. Open `ax-code`, run `/connect`, and choose Groq and one of the listed models. For a headless smoke test, the current
   bundled catalog supports:

```bash
ax-code run --model groq/openai/gpt-oss-120b "Inspect this repository without editing it and summarize its purpose."
```

If that exact model is not printed by `ax-code models groq`, use a model ID that is. The installed catalog is
authoritative for the installed release.

## Built-in free-tier and free-credit options

These providers are in AX Code's default setup picker. “Built in” means AX Code supplies the protocol adapter, model
metadata, credential flow, and provider endpoint; it does not mean every model or request is free.

| AX Code provider | No-cost path                                          | Important constraint                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groq`           | Groq Free Plan                                        | Rate limits are per model and account; check [Groq's live limits](https://console.groq.com/docs/rate-limits).                                                                                        |
| `google`         | Free-tier Gemini API models                           | Only models marked free in [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) qualify. Google states that free-tier content may be used to improve its products.                    |
| `unorouter`      | Model IDs ending in `:free`                           | UnoRouter is a third-party gateway. Its [free-model limits](https://unorouter.com/en/docs/platform/errors-and-rate-limits) are intentionally low and availability can fluctuate.                     |
| `huggingface`    | Recurring Inference Providers credit                  | Free accounts currently receive a small monthly credit, subject to change; see [Hugging Face pricing](https://huggingface.co/docs/inference-providers/en/pricing). A full agent task can exhaust it. |
| `openrouter`     | `openrouter/free` or a model-specific `:free` variant | The provider preset is built in, but the AX Code curated snapshot does not currently list the free router. Add it explicitly as shown below.                                                         |

For UnoRouter, connect with `ax-code providers login unorouter`, run `ax-code models unorouter`, and choose a model
whose ID ends in `:free`. Do not assume the paid twin without that suffix is free. UnoRouter's own catalog notes that
not every free model supports tool calling; AX Code only surfaces the tool-capable entries in its bundled catalog.

For Google or Hugging Face, connect with the matching provider ID and then use `ax-code models google` or
`ax-code models huggingface`. Check the provider's live pricing page before choosing a model.

## Add OpenRouter's free-model router

OpenRouter documents `openrouter/free` as a zero-cost router that selects an available free model compatible with the
request. Because that router is not in AX Code's current curated snapshot, add a conservative local model entry to
the `ax-code.json` at your project root (or merge it into your global AX Code config):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
  "provider": {
    "openrouter": {
      "models": {
        "openrouter/free": {
          "name": "OpenRouter Free Models Router",
          "tool_call": true,
          "limit": {
            "context": 32768,
            "output": 4096,
          },
        },
      },
    },
  },
}
```

The limits above are conservative AX Code budgeting values, not an entitlement from OpenRouter. Then connect and
verify the merged model catalog:

```bash
ax-code providers login openrouter
ax-code models openrouter
ax-code run --model openrouter/openrouter/free "Inspect this repository without editing it and identify its test command."
```

The repeated `openrouter` is intentional: the first segment is the AX Code provider ID and `openrouter/free` is the
model ID expected by OpenRouter. Free-router availability and selection vary by request; see
[OpenRouter's free-router documentation](https://openrouter.ai/docs/guides/routing/routers/free-router).

## How to use the external free-API catalog

[awesome-free-llm-apis](https://github.com/amardeeplakshkar/awesome-free-llm-apis) is useful for discovering current
offers, but it is not an AX Code compatibility or endorsement list:

- A provider in [Supported Providers and Models](supported-providers.md) has a default AX Code setup preset.
- A provider merely present in `models-snapshot.json` is registry-backed, not necessarily curated for the default
  setup flow.
- Another service can work through [Custom and Gateway Providers](custom-provider.md) when it exposes a compatible
  OpenAI or Anthropic endpoint.
- “OpenAI compatible” is necessary but not sufficient for a coding agent. The selected model also needs streaming
  text responses and reliable tool/function calling.
- Provider names, model IDs, free quotas, regions, and account requirements in third-party lists can become stale.
  Verify them against the provider's official pricing, model, and rate-limit pages before relying on them.

At this page's review date, the services named by that catalog map to AX Code as follows:

| AX Code relationship                  | Catalog services                                                                                                                                                                                                | Meaning                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default setup preset                  | Google Gemini (`google`), Groq (`groq`), OpenRouter (`openrouter`), Hugging Face (`huggingface`), UnoRouter (`unorouter`)                                                                                       | Visible in the normal provider setup flow and covered above.                                                                                                                                             |
| Registry-backed, not a default preset | Mistral (`mistral`), Cohere (`cohere`), Zhipu AI (`zhipuai`), AnyAPI (`anyapi`), Cerebras (`cerebras`), GitHub Models (`github-models`), NVIDIA NIM (`nvidia`), Cloudflare Workers AI (`cloudflare-workers-ai`) | Metadata and an adapter exist in the bundled registry, but the provider is not part of the curated default setup flow. Explicit configuration does not guarantee that a free model supports agent tools. |
| Custom protocol only                  | Api.Airforce, Kluster AI, LLM7.io, Pollinations AI                                                                                                                                                              | No AX Code preset. Configure the exact endpoint and model only if its current API is compatible with the [custom provider contract](custom-provider.md).                                                 |

In particular, the `github-copilot` preset is not the `github-models` API listed by some catalogs. Do not substitute
one provider ID or credential flow for the other. The registry-backed `zhipuai` provider also filters out GLM 3 and
GLM 4 models, so a catalog's GLM-4.x free offer is not an AX Code model path.

## Safe evaluation practices

- Test with a public or disposable repository first. A hosted provider or gateway receives the prompts and code
  context sent to its API.
- Keep the default sandbox, or use read-only mode for a review-only smoke test.
- Start with one short task and one agent. Council, arena, long sessions, and large repositories can consume many
  requests and quickly hit free-tier limits.
- Store credentials with `ax-code providers login` or an environment variable; never commit API keys to
  `ax-code.json`.
- Treat `429` and temporary unavailability as normal free-tier constraints. Wait for the provider's retry window or
  choose another currently listed free model.
