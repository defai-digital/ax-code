# Model selection and recovery

Status: Active
Scope: current-state
Last reviewed: 2026-11-26
Owner: ax-code runtime

AX Code preserves exact provider/model selections. Connecting a provider does not
add it to an automatic recovery pool. With no configured fallback, transient
failures retry the selected target within the existing retry limit and then stop.

## Configure an ordered fallback

Set `llm_routing.fallback` in user configuration, a custom configuration selected
by `AX_CODE_CONFIG`, or explicit `AX_CODE_CONFIG_CONTENT`. Targets are exact pairs;
model IDs may contain slashes. For example:

```json
{
  "model": "my-gateway/openai/gpt-oss-120b",
  "llm_routing": {
    "fallback": [
      { "providerID": "my-gateway", "modelID": "my-backup-model" },
      { "providerID": "my-other-provider", "modelID": "my-approved-model" }
    ]
  }
}
```

Replace these examples with exact IDs from your configured providers. The list
allows up to eight distinct targets. Empty or absent means no target changes.
Project and remote configuration can narrow user grants but cannot add or reorder
them. Managed restrictions provide a final ceiling. A missing configured next
target stops recovery; AX Code does not substitute another catalog entry.

Ordinary transient rate limits, recognized overload and server errors can advance
through this list after same-target retries. Authentication, permission, permanent
quota and invalid-request failures do not authorize a switch. Local provider
sessions do not automatically migrate to remote inference. Cancellation stops the
sequence. Recovery after the current request publishes output or starts a tool
also stops, preserving partial progress instead of replaying effects.

The processor normally allows five same-target retries after the initial attempt;
concurrency-limit errors have an eight-retry limit. Provider circuit breakers and
outer error limits may stop earlier. Successful tool-loop steps are new requests,
not retries of prior work. AI SDK retries are disabled at controlled direct
generation sites. External CLI and gateway internal attempts may remain opaque.

## Auxiliary work and existing configuration

When the runtime can resolve the primary, it uses these preferences for work
that has yet to send a model request:

| Purpose                                       | Order                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Session title and recap                       | A usable `agent.title.model` or `agent.recap.model`, then `small_model`, then the session model |
| Compaction                                    | A usable `agent.compaction.model`, then the session model                                       |
| Optional complexity classification or routing | A usable configured auxiliary model. If unavailable, skip the optional routing step.            |

Local sessions keep auxiliary work on their own provider. Use exact
`provider/model` IDs for all pins. An unavailable catalog entry can fall through
the applicable auxiliary sequence above. A malformed value is a configuration
error. For headless automation, pass an explicit `--model` to make selection
reproducible.

## Inspect the effective configuration

```sh
ax-code doctor
ax-code debug routing
ax-code debug routing --model my-gateway/openai/gpt-oss-120b
```

Use the **Model pins** section of `doctor` for a summary. `debug routing` shows the
primary, ordered fallback, auxiliary preference, enabled agent pins, retry limits,
and the full `warnings` list. An explicit `--model` previews another primary and
still reports problems in the saved configuration. Configuration loading and
catalog discovery can contact providers. The preview sends no inference request.

User messages record whether selection came from a request, an agent pin,
complexity/hybrid routing or session/config defaults. This source describes local
ingress; `request` does not attest who operated an API client. Request evidence
records the selected purpose and target. Model-generated self-descriptions and
model names in memory or tool examples are not routing evidence. AX Trust and
external providers retain responsibility for upstream routing and authorization.

## Provider state diagnostics

`debug routing` reports discovery status and model exclusion reasons. Use the
warning code to decide what to check:

| Warning code              | What to check                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `invalid_format`          | Use a complete `provider/model` ID. A malformed enabled agent pin can prevent agent loading. |
| `provider_not_configured` | Connect or enable the provider.                                                              |
| `catalog_unavailable`     | Start the runtime or restore access, check the model list, then rerun the diagnostic.        |
| `model_not_found`         | Check the exact model ID against the completed catalog.                                      |
| `excluded`                | Inspect the reported provider filter or model policy and choose an eligible model.           |

A stopped local server or unreachable dedicated GPU endpoint can make its catalog
unavailable. An HTTP error or invalid response from a reachable endpoint still
counts as a discovery failure.
