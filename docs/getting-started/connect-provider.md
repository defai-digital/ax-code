# Connect your first model provider

Status: Active
Scope: current-state
Last reviewed: 2026-10-26
Owner: ax-code runtime

## Choose a connection

A provider is the connection to a model service; a model is the specific model selected through it. Connecting a provider does not select every model or grant account access.

In the terminal UI, enter `/connect`. Choose the path below. Desktop has its own provider settings and bundled runtime; these slash commands describe the terminal UI.

1. Cloud API: choose API Cloud Provider, select your service and follow the credential prompts. A chat subscription does not necessarily include API access or API credit.

2. Coding CLI: install and sign in to the supported CLI first, then choose CLI Provider. AX Code reuses that local login; capabilities depend on the adapter.

3. Local model: start Ollama or LM Studio and load a tool-capable model, then choose Local LLM runtime and confirm the endpoint. AX-Engine runtime has its own setup and model download flow on supported Macs.

4. Gateway: choose AX Trust for an AX Trust endpoint, API Cloud Provider → Custom API provider for another gateway, or Private GPU cloud for a dedicated compatible deployment. Enter the service URL, token and exact advertised model IDs.

## Check the connection

Run these commands in an interactive terminal. The login command prompts for the provider and credentials; do not paste a real key into a shared command or repository file.

```sh
ax-code providers login
ax-code providers list
ax-code models
```

You should see your provider and usable model IDs. A saved credential or successful model listing alone does not prove inference permission. Continue with [model selection](select-model.md) and send a small test request.

## Manage credentials and configuration

Use `/providers` to manage connections and `/connect` to replace a key. Disable retains saved credentials; disconnect removes the stored credential. Environment variables and configured keys can still supply access.

Use project `ax-code.json` for shared non-secret settings, or global `~/.config/ax-code/ax-code.json` for your own defaults. Keep secrets out of version control; use the provider credential prompt or environment references described in the [gateway guide](../providers/custom-provider.md). Restart after manual configuration edits.

## If setup fails

- Authentication failure: confirm the key belongs to the chosen service, endpoint and API plan. For a coding CLI, check its own login first.

- Empty model list or connection refused: confirm the local server is running, a model is loaded and the URL/port is correct. Ollama normally uses `http://localhost:11434/v1`; LM Studio uses `http://localhost:1234/v1`.

- Model rejected: use the exact ID from the endpoint and check account permissions. For gateways, a display name may differ from the upstream request ID.

- Missing provider: check `enabled_providers` and `disabled_providers`. For installation diagnostics, run `ax-code doctor`; this does not validate your provider account.

## Next steps

[Provider catalog and login methods](../providers/supported-providers.md) · [Custom gateways and private GPU endpoints](../providers/custom-provider.md) · [Choose a model](select-model.md) · [Create an AX Wiki](wiki-quickstart.md) · [Documentation hub](../README.md)
