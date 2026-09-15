# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-09-15
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
