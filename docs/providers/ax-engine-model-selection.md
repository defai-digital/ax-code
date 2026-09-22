# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-09-20
Owner: ax-code runtime

AX Code offers only these two development packs through **AX Engine (Local)** on eligible Apple Silicon Macs. Tiel Coder is the default; Cyber-Tiel Coder is the alternative.

| Model                              | Hugging Face repository                                                                                                                     | AX Code selection                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Tiel Coder 35B A3B MXFP4 MTP       | [AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP](https://huggingface.co/AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP)             | `tiel-coder-35b-axq-mxfp4` (default) |
| Cyber-Tiel Coder 35B A3B MXFP4 MTP | [AutomatosX/AX-Cyber-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP](https://huggingface.co/AutomatosX/AX-Cyber-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP) | `cyber-tiel-coder-35b-axq-mxfp4`     |

The aliases pin revisions `5ab39b24bfd7f65203be9b7823b1840486f58b6d` and `fe05e871ec69ad9ae8eac01fd285555514ac7daf`, respectively. Both use the `mlx` selector, preserving the publisher's MXFP4 package. The model cards describe development requantizations with no certified quality-parity or MTP-speed claim; selecting them does not establish native execution or a speed improvement.

AX Code bundles the signed [AX Engine 7.5.5 release](https://github.com/defai-digital/ax-engine/releases/tag/v7.5.5), which includes the Tiel sidecar namespace loader fix from commit `51137c71a6794964d52c32c95e275c0923ed8d0b`. Older Homebrew 7.4.0 binaries lack that fix and reject these packs with `MlxMtpRequiredButUnavailable`. Keep MTP required; explicit runtime overrides must also contain the fix. The [native prefill and decode measurements](../guides/tiel-runtime-phases-2026-09-19.md) retain their original tested build identity and do not certify performance of the newer release.

Qwen3.8 27B, Ornith, Qwen3-Coder-Next and all other repositories are excluded from new managed selection and downloads. Each selected repository appears once. Configured aliases and older cached revisions do not add choices after discovery. Other providers and the separately configured loopback attach interface retain their behavior. To run AX Engine's own dense default, start `ax-engine serve qwen3.8-27b:axq` and attach that local endpoint; measured product-path MTP is **31.05 tok/s** decode on Mac mini M4 Pro 64 GB and **76.90 tok/s** decode / **795.3 tok/s** prefill on M5 Max 128 GB. Those figures are not Tiel completion tok/s and not AX Code session speed. See [Tiel peer summary](../guides/tiel-peer-2026-09-20.md#do-not-mix-with-qwen-38-27b).

## Inspect the available models

```bash
ax-code providers ax-engine models --json
ax-code providers ax-engine models --refresh --json
```

Refreshing reads Hugging Face metadata without downloading weights or starting a model. The bundled metadata works offline and supplements the selected repository if it is missing from an older cache. Present revisions are not silently replaced with a different bundled revision. Selection still requires valid source metadata; the repository restriction does not establish native capability.

`GET /provider/ax-engine/models` returns the running CLI's catalog, including each model's exact ID, repository, quantization, local state, memory/disk estimates, and verification status. An external GUI uses this runtime API. If it shows an older list, check the CLI it launches and its version. AX Coder development can select a source runtime with `AX_CODE_BINARY` or `settings.axCodeBinary`.

## Prepare the selected model

Copy the exact model ID from the catalog. The default Tiel alias uses `mlx`:

```bash
ax-code providers ax-engine prepare \
  --model tiel-coder-35b-axq-mxfp4 --quantization mlx --download --start
```

Excluded models fail new prepare, download, and managed activation requests before starting work. Existing model records remain available for status and cleanup; removed Qwen3.8, Ornith and Qwen3-Coder-Next IDs are never redirected to either Tiel artifact. Removing an option does not delete its weights or stop an existing server.

## Memory and runtime verification

Both selected aliases use a 65,536-token context, 8,192-token output limit, estimated 64 GiB memory requirement and 32 GiB download disk budget. These are AX Code serving limits, not the upstream maximum context. (Raised from an initial 32,768-token context: that left only 24,576 usable input tokens after the output reserve, less than the fixed AX Code agent system prompt and tool schemas require, so a brand-new session could never send a first turn.)

Each memory estimate includes weights, sidecars, KV cache, buffers, and host reserve. Use the live catalog's fit result for the current machine. These estimates are not hardware or model-quality certification.

The 64 GiB figure is a conservative full-context (64K) planning budget, not a hard floor. For a
comfortable managed local-inference machine, we recommend an Apple Silicon M4 Pro with 48 GB of
unified memory or above (for example a Mac Mini M4 Pro 48 GB); smaller Apple Silicon Macs can
still run AX Code itself from 8 GB with cloud/API models or lighter local runtimes.

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
applied to these MoE packs. See the [profile comparison](../guides/tiel-mtp-profile-2026-09-19.md)
for measured gains. Cyber-Tiel retains `agentic`; managed read-task probes failed
with both profiles, so its task reliability remains unresolved.
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
Automatic runtime selection requires AX Engine 7.5.0 or newer to enforce these policies, including
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

The current public Tiel versus MTPLX snapshot is the 20 September 2026 native-API
campaign summarized in [Tiel peer summary](../guides/tiel-peer-2026-09-20.md).
On M5 Max 128 GiB the managed default Tiel pack completed at **194.88 tok/s**
including TTFT (decode 217.85). Cyber-Tiel peak decode **249.01 tok/s** is the
alternate pack, not the default. Those figures are not AX Code session speed.

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
