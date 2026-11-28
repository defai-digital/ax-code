# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-11-28
Owner: ax-code runtime

**AX Engine (Local)** manages the packs reviewed for the
[AX Code collection](https://huggingface.co/collections/AutomatosX/ax-code). The
table lists the managed aliases in AX Code 7.31.8. Each alias resolves to a
specific model pack and revision. See [Model Downloads](ax-code-model-downloads.md)
for repository links and revisions.

| Managed model                          | Model ID                          | Minimum unified memory |
| -------------------------------------- | --------------------------------- | ---------------------: |
| Tiel Coder 35B A3B MXFP4 MTP (default) | `tiel-coder-35b-axq-mxfp4`        |                 48 GiB |
| Tiel Coder 35B A3B MXFP8 MTP           | `tiel-coder-35b-axq-mxfp8`        |                 64 GiB |
| Swift 1.5 Qwen3.8-27B MXFP4 MTP        | `swift-1.5-qwen3.8-27b-axq-mxfp4` |                 32 GiB |
| Swift 1.5 Qwen3.8-27B MXFP8 MTP        | `swift-1.5-qwen3.8-27b-axq-mxfp8` |                 64 GiB |
| Cyber-Tiel Coder 35B A3B MXFP4 MTP     | `cyber-tiel-coder-35b-axq-mxfp4`  |                 64 GiB |
| Cyber-Tiel Coder 35B A3B MXFP8 MTP     | `cyber-tiel-coder-35b-axq-mxfp8`  |                 64 GiB |
| Qwen3.8 Flash Next MXFP4 MTP           | `qwen3.8-flash-next-axq-mxfp4`    |                192 GiB |

## Install AX Engine

Managed inference requires **macOS 26 or later** on an Apple Silicon **M2 or
newer**, plus the selected pack's memory and disk capacity.

```bash
ax-code providers ax-engine install
ax-code providers ax-engine status --json
```

The installer in AX Code 7.31.8 downloads and verifies the pinned
[AX Engine 8.0.4 archive](https://github.com/defai-digital/ax-engine/releases/tag/v8.0.4).
AX Code accepts a verified external engine from version **7.7.0** onward. Engines
from **7.10.0** download public packs natively. See
[Installing the engine](supported-providers.md#installing-the-engine) for binary
selection, Homebrew, and the older Python download path.

## Inspect the available models

```bash
ax-code providers ax-engine models --json
ax-code providers ax-engine models --refresh --json
```

Refreshing reads Hugging Face metadata without downloading weights or starting a model. The bundled metadata works offline and supplements the selected repository if it is missing from an older cache. Present revisions are not silently replaced with a different bundled revision. Selection still requires valid source metadata; the repository restriction does not establish native capability.

`GET /provider/ax-engine/models` returns the running CLI's catalog, including each model's exact ID, repository, quantization, local state, memory/disk estimates, and verification status. An external GUI uses this runtime API. If it shows an older list, check the CLI it launches and its version. AX Code desktop development can select a source runtime with `AX_CODE_BINARY` or `settings.axCodeBinary`.

## Prepare the selected model

Copy the exact model ID and quantization selector from the catalog. The default
Tiel alias uses `mlx`:

```bash
ax-code providers ax-engine prepare \
  --model tiel-coder-35b-axq-mxfp4 --quantization mlx --download --start
```

The managed catalog admits only reviewed packs. To use a different model with an
already-running engine, configure a [loopback attachment](../architecture/local-engine.md)
or [connect an OpenAI-compatible endpoint](local-mlx-runtimes.md). Existing local
model records remain available for status and cleanup.

## Memory and runtime verification

The managed aliases use a 65,536-token context and an 8,192-token output
limit in AX Code 7.31.8. Tiel MXFP4 (`tiel-coder-35b-axq-mxfp4`) has a 32 GiB
download disk budget, and Swift MXFP4 (`swift-1.5-qwen3.8-27b-axq-mxfp4`) has a
24 GiB download disk budget. Larger packs have their own requirements. Check
`fit` in `ax-code providers ax-engine models --json` for the current machine,
which accounts for local model files, memory, disk, and runtime readiness.

Before managed activation, AX Code checks the active AX Engine model's text and structured tool contract. A `verification-required` state means preparation is complete but that live contract has not been established. Repository names or MTP sidecars alone do not prove reasoning, vision, MTP acceleration, or multi-turn coding quality.

Session compaction uses the active model's context/output budgets and reserves input headroom. The selected variant keeps its own catalog budget; the source model's maximum context is not a managed memory guarantee.

See [Local Engine Architecture](../architecture/local-engine.md) for lifecycle and transport details.

## Managed MTP policy

Managed AX Engine defaults to `required`, matching the selected MTP artifact.
An unavailable drafter fails startup instead of silently falling back to direct decoding.
MTP weights and the pure-stacking setting do not establish active acceleration.
The default Tiel Coder pack uses the `auto` speculation profile so AX Engine selects
the model's draft gate instead of the generic `agentic` profile's 0.80 override.
This is separate from the MTP activation policy: `auto` tuning still uses
`required` MTP. The old dense Qwen3.8-specific experimental environment is not
applied to these MoE packs. See the [profile comparison](../benchmarks/tiel-mtp-profile-2026-09-19.md)
for measured gains. Swift retains `agentic` until its managed tool-use checks pass.
The activation policy remains `required`; the engine must admit the actual drafter.
To explicitly select a policy, set `provider.ax-engine.options.mtpPolicy` in `ax-code.json`:

```json
{
  "provider": {
    "ax-engine": {
      "options": {
        "mtpPolicy": "required"
      }
    }
  }
}
```

| Policy               | Behavior                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `disabled`           | Use direct decoding; do not request a model drafter.                                                        |
| `auto`               | Let AX Engine decide whether the model and route admit MTP. This does not guarantee activation.             |
| `required` (default) | Require an admitted MTP drafter; AX Engine rejects an unavailable drafter instead of silently falling back. |

`AX_ENGINE_MTP_POLICY` provides the same three values when no provider option is set.
Automatic runtime selection requires AX Engine 7.7.0 or newer to enforce these policies, including
the default `required` policy. Explicit `disabled` and `auto` settings still override
the default. Older/unknown binaries reject policy selection
before replacing a running engine; upgrade before using the managed policy controls. Historical state files without a recorded policy
report their launched policy as unknown and are replaced on the next managed start.
Changing policy takes effect on the next managed start or model request and replaces
an existing process with a different policy. It does not change model selection or storage.

`ax-code providers ax-engine start --mtp-policy disabled` overrides the policy for
that start only. Set the persistent provider option if subsequent coding requests
should use the same override. The prepare/start HTTP bodies also accept `mtpPolicy`.
These managed settings do not reconfigure separately attached endpoints.
After updating source, restart `pnpm run dev` to load the new default; an already
running development backend retains its loaded code until restarted.

`ax-code providers ax-engine status` (or `--json`) separates the requested policy,
launched policy, and observed `active`/`inactive`/`unknown` state. Observation uses
the engine's latest model-route metric, not model metadata or historical draft
counts. Missing exact-model samples remain unknown, including before the first
observed engine step; server-wide aggregates do not establish activation.
Configured `required` is not displayed
as proof of activity. Draft/accepted counts, when available, are cumulative for the
resident engine. A pending policy change is reported without restarting it during
status inspection. MTP activation is not a promise of a particular token rate.

## Interpreting local response speed

Managed AX Engine does not impose a tokens-per-second ceiling. A measurement
such as 50 tok/s is neither a configured target nor an upper limit: faster
hardware can produce tokens faster. Context size, output budgets, and request
concurrency limits control capacity, not a fixed token generation rate.

The [20 September 2026 Tiel versus MTPLX benchmark](../benchmarks/tiel-peer-2026-09-20.md)
records the native API results with its tested versions, hardware, and metrics.
Use full AX Code session timings when evaluating coding workflows.

Compare measurements at the same input length, output budget, sampling settings,
and cache state. Short-prompt decode measurements do not establish a minimum
rate for a coding session with tens of thousands of context tokens. Reusing a
prefix reduces prompt processing; subsequent decoding still attends to that
context. MTP activation alone does not establish useful draft acceptance or a
fixed speedup.

Separate startup/setup, time to first content, and sustained generation when
investigating a slow turn. The engine's `ax_runtime_decode_tok_per_sec` metric is
an exponentially weighted average across requests, not the current response's
rate. Use request timings and token counts for that response, and counter deltas
for its MTP acceptance. Streaming chunks can contain multiple tokens; counting
chunks as tokens gives an incorrect rate.

AX Code reuses successful executable-version probes for up to five minutes.
It checks executable availability on every resolution and invalidates cached
versions when launcher or native-server file identity changes. Failed probes
remain retryable. This reduces repeated setup work; it does not change model
decode speed. A development backend must be restarted to load source changes.

## Related

- [Supported Providers and Models](supported-providers.md)
- [AX Code model downloads](ax-code-model-downloads.md)
- [MTPLX and oMLX local runtimes](local-mlx-runtimes.md)
- [Local Engine Architecture](../architecture/local-engine.md)
