# Local Engine Integration (AX Code)

Status: Active
Scope: current-state
Last reviewed: 2026-07-26
Owner: ax-code runtime
Related: [ax-engine LOCAL-ENGINE-CLIENTS](https://github.com/defai-digital/ax-engine/blob/main/docs/LOCAL-ENGINE-CLIENTS.md)

## Decision

AX Code uses the **sidecar HTTP** backend for AX Engine. Two operator modes share
the same OpenAI-compatible `/v1` chat wire:

| Mode                  | When                       | How                                                     |
| --------------------- | -------------------------- | ------------------------------------------------------- |
| **Managed** (default) | AX Code owns lifecycle     | prepare model → spawn `ax-engine serve` → health → chat |
| **Attach**            | You already run the server | set `baseURL` + `apiKey` only; no spawn                 |

```text
AX Code (TypeScript)
  → Managed: ensure/prepare → spawn ax-engine serve → /v1
  → Attach:  provider.options.baseURL (+ apiKey) → /v1
  → @ai-sdk/openai-compatible language model
```

The TUI and Desktop **AX Engine** settings offer _Managed local server_ or
_Attach existing server_ (endpoint + API key). Both surfaces validate an attach
before saving it. They never start, reload, or stop a server in attach mode.

### Attach configuration

Trusted global config records the non-secret connection choice:

```json
{
  "provider": {
    "ax-engine": {
      "options": {
        "connectionMode": "attach",
        "baseURL": "http://127.0.0.1:31418/v1"
      }
    }
  }
}
```

The UI stores the bearer token in AX Code's encrypted auth store, never in
`ax-code.json`. Project-controlled provider URLs are intentionally ignored by
the untrusted-config policy. Environment variables remain an advanced,
backward-compatible attach path:

| Variable            | Role                                                          |
| ------------------- | ------------------------------------------------------------- |
| `AX_ENGINE_HOST`    | Base URL (with or without `/v1`); local host only             |
| `AX_ENGINE_API_KEY` | Bearer token (must match server `--api-key` / env if enabled) |

Default managed key is `local` when unset. Attach accepts only HTTP(S) loopback
hosts, rejects URL-embedded credentials/query strings, validates `/v1/models`
and structured tool calling, and refuses to attach to a process AX Code owns.
Set `connectionMode` to `managed` to override even a lingering
`AX_ENGINE_HOST`.

AX Code does **not** link `ax-engine-sdk` in-process. AX Code and the current
AX Studio Electron app both use the `/v1` sidecar contract and share lifecycle
**phase names**. gRPC and in-process SDK are non-goals for AX Code chat.

## Why sidecar

| Factor         | Sidecar choice                                                   |
| -------------- | ---------------------------------------------------------------- |
| Host language  | Node/Bun agent runtime with an explicit native-process boundary  |
| Isolation      | Multi-GB models and native crashes stay out of the agent process |
| Upgrade        | Version-gated Homebrew/PATH binary without rebuilding ax-code    |
| Provider model | Same OpenAI-compatible path as other local/cloud providers       |
| Multi-client   | One server can be health-checked and stopped via `server.json`   |

## Lifecycle phases

Implementation: `packages/ax-code/src/provider/ax-engine/lifecycle.ts`

| Phase                | When (AX Code mapping)                                    |
| -------------------- | --------------------------------------------------------- |
| `unavailable`        | Platform eligibility fails                                |
| `missing_dependency` | Binary missing / version too old / not executable         |
| `missing_model`      | Model path not prepared                                   |
| `starting`           | Server process recorded but not ready yet                 |
| `ready`              | `server.ready` and process health OK                      |
| `degraded`           | Ready but capability inspection says toolcall unsupported |
| `error`              | Health/start failure blockers on a running attempt        |

Severity order matches ax-engine `docs/LOCAL-ENGINE-CLIENTS.md`.

## Related code

| Area                               | Path                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Server spawn / health              | `packages/ax-code/src/provider/ax-engine/server.ts`                     |
| Provider loader (managed + attach) | `packages/ax-code/src/provider/ax-engine/provider-loader.ts`            |
| TUI managed / attach               | `packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx`        |
| Connect-mode helpers               | `packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts` |
| Aggregate status                   | `packages/ax-code/src/provider/ax-engine/status.ts`                     |
| Phase mapping                      | `packages/ax-code/src/provider/ax-engine/lifecycle.ts`                  |
| Model policy                       | [AX Engine Model Selection](../providers/ax-engine-model-selection.md)  |

## Non-goals

- Replacing sidecar with in-process SDK embedding in AX Code
- Adopting gRPC as the primary chat transport
- Custom Unix-socket or non-OpenAI chat framing for first-party clients
