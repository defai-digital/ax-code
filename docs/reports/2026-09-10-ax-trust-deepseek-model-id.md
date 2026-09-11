# AX Trust DeepSeek Flash returns `model is not allowed` after endpoint migration

Status: Local configuration fix verified
Observed: 2026-09-10 (America/Halifax)
Scope: Manually configured `ax-trust` provider on Windows

## Problem

After changing the provider endpoint from `https://ax-trust.defai.digital/v1`
to `https://defai-01.ax-trust.com/v1`, selecting
`ax-trust/deepseek-v4-flash` failed with HTTP 403 and `model is not allowed`.
The local model entry had no explicit `id`, so requests used
`deepseek-v4-flash`. The new gateway advertised `deepseek-flash` instead.

## Reproduction and evidence

1. Configure the new endpoint and a valid API key.
2. Keep the manually declared `deepseek-v4-flash` model without an `id` override.
3. Select that model and send a prompt.

Expected: The selected Flash model produces a response.
Observed: The session log recorded provider `ax-trust`, model
`deepseek-v4-flash`, HTTP 403, and `model is not allowed`.

An authenticated `GET /models` returned HTTP 200 and 19 model IDs, including
`deepseek-flash` and `deepseek-v4-pro`. It did not include
`deepseek-v4-flash` or `deepseek-v4-flash-vision-exp`. Model-list access did
not prove that the stale model ID could be used for inference.

## Applied fix

In `~/.config/ax-code/ax-code.json`, set:

```json
{
  "provider": {
    "ax-trust": {
      "models": {
        "deepseek-v4-flash": {
          "id": "deepseek-flash"
        }
      }
    }
  }
}
```

Merge this fragment into the existing configuration. The local selection key,
display name, existing capability settings, and credential remain intact.
The runtime already supports an explicit model `id` as its API request ID;
no runtime source change is required. Restart AX Code to reload the configuration.

The accompanying [configuration example](../examples/ax-trust-deepseek-flash.json)
contains the corrected endpoint and mapping, using an environment-variable
reference instead of a credential. It is a minimal merge example, not an export
of the user's full configuration.

## Validation and limits

- Read back the local configuration and confirmed
  `deepseek-v4-flash -> deepseek-flash`.
- Sent one direct `POST /chat/completions` request to the new endpoint using
  the existing key, model `deepseek-flash`, prompt `Reply with OK.`,
  `max_tokens: 16`, and `stream: false`.
- Received HTTP 200 with response choices. This confirmed the gateway accepts
  the corrected ID with that key.
- A restarted TUI session, tool calls, streaming, and vision were not tested.
- The unavailable `deepseek-v4-flash-vision-exp` entry was not redirected;
  matching Flash names does not establish equivalent vision capabilities.
- These observations describe the gateway at verification time; future model
  availability and key permissions may differ.

No API keys, auth-store files, conversation contents, or raw logs are included
in this report or the example.
