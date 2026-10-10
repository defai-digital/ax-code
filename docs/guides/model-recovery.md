# Model selection and recovery

Status: Active
Scope: current-state
Last reviewed: 2026-10-10
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

Without `small_model`, title, recap and compaction inherit the primary model.
An explicit `small_model` or role-specific agent model still selects that exact
target. Invalid pins fail instead of moving to another provider or model. Optional
title/recap work retains its local-title/skip behavior. Compaction preserves the
transcript when it fails and only changes models through configured recovery.

Configured primary models, task/agent/command pins and saved recent selections
also remain exact. Remove or correct an unavailable pin explicitly. Headless runs
with no configured or recent selection require `--model`. The visible model picker
can offer recommendations, but those suggestions do not become a recovery list.

The optional complexity classifier requires an explicit auxiliary model; without
one, classification is skipped. It is anchored to the requested provider when a
primary is supplied. Explicit primary choices survive agent-topic routing.

## Inspect the effective configuration

```sh
ax-code debug routing
ax-code debug routing --model my-gateway/openai/gpt-oss-120b
```

This prints the exact primary, ordered fallback, auxiliary selection, agent pins
and retry limit. It does not send a model request or probe model availability.
Normal configuration loading may fetch configured remote settings. This is a
configuration explanation, not a reconstruction of past gateway behavior.

User messages record whether selection came from a request, an agent pin,
complexity/hybrid routing or session/config defaults. This source describes local
ingress; `request` does not attest who operated an API client. Request evidence
records the selected purpose and target. Model-generated self-descriptions and
model names in memory or tool examples are not routing evidence. AX Trust and
external providers retain responsibility for upstream routing and authorization.
