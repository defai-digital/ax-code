# Local Engine Integration (AX Code)

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-14  
Owner: ax-code runtime  
Related: [ax-engine LOCAL-ENGINE-CLIENTS](https://github.com/defai-digital/ax-engine/blob/main/docs/LOCAL-ENGINE-CLIENTS.md)

## Decision

AX Code uses the **sidecar HTTP** backend for AX Engine:

```text
AX Code (TypeScript)
  → ensure/install/prepare (provider/ax-engine/*)
  → spawn: ax-engine serve <modelPath> --port …
  → OpenAI-compatible HTTP @ http://127.0.0.1:<port>/v1
  → @ai-sdk/openai-compatible language model
```

AX Code does **not** link `ax-engine-sdk` in-process (that is AX Studio’s default
for the `mlx` provider). Both products share lifecycle **phase names** and the
`/v1` chat contract; they intentionally differ on process model.

## Why sidecar (not Studio’s in-process path)

| Factor | Sidecar choice |
|---|---|
| Host language | Node/Bun agent runtime, not a Rust Tauri embed |
| Isolation | Multi-GB models and native crashes stay out of the agent process |
| Upgrade | Managed binary pin (`AX_ENGINE_MIN_VERSION`) without rebuilding ax-code |
| Provider model | Same OpenAI-compatible path as other local/cloud providers |
| Multi-client | One server can be health-checked and stopped via `server.json` |

## Lifecycle phases

Implementation: `packages/ax-code/src/provider/ax-engine/lifecycle.ts`

| Phase | When (AX Code mapping) |
|---|---|
| `unavailable` | Platform eligibility fails |
| `missing_dependency` | Binary missing / version too old / not executable |
| `missing_model` | Model path not prepared |
| `starting` | Server process recorded but not ready yet |
| `ready` | `server.ready` and process health OK |
| `degraded` | Ready but capability inspection says toolcall unsupported |
| `error` | Health/start failure blockers on a running attempt |

Severity order matches ax-engine `docs/LOCAL-ENGINE-CLIENTS.md`.

## Related code

| Area | Path |
|---|---|
| Server spawn / health | `packages/ax-code/src/provider/ax-engine/server.ts` |
| Provider loader | `packages/ax-code/src/provider/ax-engine/provider-loader.ts` |
| Aggregate status | `packages/ax-code/src/provider/ax-engine/status.ts` |
| Phase mapping | `packages/ax-code/src/provider/ax-engine/lifecycle.ts` |
| Model policy | [ax-engine-model-selection.md](./ax-engine-model-selection.md) |

## Non-goals

- Replacing sidecar with in-process SDK embedding in AX Code
- Adopting gRPC as the primary chat transport
- Forcing AX Studio to abandon in-process MLX
