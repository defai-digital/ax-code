# Local Engine Integration (AX Code)

Status: Active
Scope: current-state
Last reviewed: 2026-09-10
Owner: ax-code runtime
Related: [ax-engine LOCAL-ENGINE-CLIENTS](https://github.com/defai-digital/ax-engine/blob/main/docs/LOCAL-ENGINE-CLIENTS.md)

## Local runtime setup

Select **AX-Engine runtime** in `/connect`, then **Select a model**. AX Code
configures the local runtime and starts it when the selected model is needed.
There is no endpoint URL or API-key form. **View status**, **Stop local runtime**
(when running), and **Disable** manage the local process.

AX Code uses the **sidecar HTTP** backend for AX Engine. It starts
`ax-engine serve`, tracks the owned process, and resolves the loopback address
and port automatically. The user selects a model; AX Code handles transport
configuration.

```text
AX Code (TypeScript)
  -> select local model -> ensure/prepare -> spawn ax-engine serve
  -> managed loopback /v1 -> @ai-sdk/openai-compatible language model
```

Selecting a model explicitly saves managed lifecycle and clears legacy attach
endpoint/key settings. This also overrides a lingering `AX_ENGINE_HOST` value.
Older SDK clients retain the legacy loopback-only attach API and its credential
validation. That compatibility path is not part of the provider menu.

AX Code does not link the AX Engine SDK in-process. AX Engine owns model
execution, and AX Code owns the client-side process lifecycle. Host eligibility,
model preparation, and live tool-calling checks still apply.

Cold startup has a 600-second readiness limit. Startup time depends on model
size, storage throughput and available memory.
An exhausted startup stops the turn with the server log and model path;
AX Code does not automatically restart another cold load or switch providers.
Resolve the reported issue before retrying explicitly.
The model setup envelope, including lifecycle-lock waiting and capability
discovery, is limited to 660 seconds. Expiry cancels pending setup and stops
automatic retries. Cancelling a request also stops waiting immediately, even
when a setup dependency has not yet responded. Health replies arriving after
the readiness deadline, or after the owned process exits, cannot establish
readiness.

Once ready, the engine stays resident across conversation turns. Completing
or cancelling the initiating turn does not stop the ready engine. Cancelling
while startup is still in progress terminates that attempt and removes its
process record. Use **Stop local runtime** to stop a resident engine explicitly.

AX Code follows the standard Hugging Face cache location and respects the
user's storage selection, including local disks, SMB and NFS mounts. Cache
resolution is `HF_HUB_CACHE`, then `HF_HOME/hub`, then
`XDG_CACHE_HOME/huggingface/hub`, then `~/.cache/huggingface/hub`.
An explicitly configured or already prepared model path takes precedence over
cache discovery. AX Code does not relocate weights or override these choices
based on storage type. Startup diagnostics report the actual model path so
users can investigate availability and read performance in their chosen storage.

For an existing engine, AX Code makes up to three health probes, each limited to two seconds
and separated by 250 milliseconds, before restarting an unresponsive process.
Cancelling the request preserves the existing process.

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
| TUI local runtime                  | `packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx`        |
| Local action helpers               | `packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts` |
| Aggregate status                   | `packages/ax-code/src/provider/ax-engine/status.ts`                     |
| Phase mapping                      | `packages/ax-code/src/provider/ax-engine/lifecycle.ts`                  |
| Model policy                       | [AX Engine Model Selection](../providers/ax-engine-model-selection.md)  |

## Non-goals

- Replacing sidecar with in-process SDK embedding in AX Code
- Adopting gRPC as the primary chat transport
- Custom Unix-socket or non-OpenAI chat framing for first-party clients
