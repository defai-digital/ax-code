# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-09-18
Owner: ax-code runtime

AX Code offers only AutomatosX Qwen3.8 27B MLX AXQ 6-bit MTP through **AX Engine (Local)** on eligible Apple Silicon Macs:

| AXQ variant | Hugging Face repository                                                                                         | AX Code selection                |
| ----------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 6-bit MTP   | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP) | `qwen3.8-27b-axq-6bit` (default) |

Other Qwen3.8 27B AXQ variants, Ornith, Qwen3-Coder-Next, other model sizes, non-AXQ packs, and other publishers are excluded from managed local selection. The selected repository appears once. Configured aliases and older cached revisions do not add choices after discovery. Other providers and the existing separately configured loopback attach interface retain their behavior.

## Inspect the available models

```bash
ax-code providers ax-engine models --json
ax-code providers ax-engine models --refresh --json
```

Refreshing reads Hugging Face metadata without downloading weights or starting a model. The bundled metadata works offline and supplements the selected repository if it is missing from an older cache. Present revisions are not silently replaced with a different bundled revision. Selection still requires valid source metadata; the repository restriction does not establish native capability.

`GET /provider/ax-engine/models` returns the running CLI's catalog, including each model's exact ID, repository, quantization, local state, memory/disk estimates, and verification status. An external GUI uses this runtime API. If it shows an older list, check the CLI it launches and its version. AX Coder development can select a source runtime with `AX_CODE_BINARY` or `settings.axCodeBinary`.

## Prepare the selected model

Copy the exact model ID from the catalog. The default 6-bit MTP alias retains `mlx6bit`:

```bash
ax-code providers ax-engine prepare \
  --model qwen3.8-27b-axq-6bit --quantization mlx6bit --download --start
```

Excluded models fail new prepare, download, and managed activation requests before starting work. Existing model records remain available for status and cleanup; removed Ornith, Qwen3-Coder-Next, and other Qwen3.8 27B AXQ IDs are never redirected to the remaining artifact. Removing an option does not delete its weights or stop an existing server.

## Memory and runtime verification

The Qwen3.8 27B 6-bit MTP alias budget remains 65,536 context tokens and 16,384 output tokens, with a 64 GiB memory requirement.

Each memory estimate includes weights, sidecars, KV cache, buffers, and host reserve. Use the live catalog's fit result for the current machine. These estimates are not hardware or model-quality certification.

Before managed activation, AX Code checks the active AX Engine model's text and structured tool contract. A `verification-required` state means preparation is complete but that live contract has not been established. Repository names or MTP sidecars alone do not prove reasoning, vision, MTP acceleration, or multi-turn coding quality.

Session compaction uses the active model's context/output budgets and reserves input headroom. The selected variant keeps its own catalog budget; the source model's maximum context is not a managed memory guarantee.

See [Local Engine Architecture](../architecture/local-engine.md) for lifecycle and transport details.

## Managed MTP policy

Managed AX Engine defaults to `required`, matching the selected MTP artifact.
An unavailable drafter fails startup instead of silently falling back to direct decoding.
MTP weights and the pure-stacking setting do not establish active acceleration.
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
Managed starts require AX Engine 7.4.0 or newer to enforce these policies, including
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
After updating source, restart `npm run dev` to load the new default; an already
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
