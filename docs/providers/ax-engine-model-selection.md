# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-09-14
Owner: ax-code runtime

AX Code offers only AutomatosX Qwen3.8 27B MLX AXQ repositories through **AX Engine (Local)** on eligible Apple Silicon Macs. The eight variants are:

| AXQ variant | Hugging Face repository                                                                                           | AX Code selection                |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 6-bit MTP   | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP)   | `qwen3.8-27b-axq-6bit` (default) |
| 4-bit       | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit)           | Pinned `repository@<commit>`     |
| 4-bit MTP   | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP)   | Pinned `repository@<commit>`     |
| 6-bit       | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit)           | Pinned `repository@<commit>`     |
| 8-bit       | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-8bit](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-8bit)           | Pinned `repository@<commit>`     |
| 8-bit MTP   | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-8bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-8bit-MTP)   | Pinned `repository@<commit>`     |
| MXFP4       | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-MXFP4](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-MXFP4)         | Pinned `repository@<commit>`     |
| MXFP4 MTP   | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-MXFP4-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-MXFP4-MTP) | Pinned `repository@<commit>`     |

Ornith, Qwen3-Coder-Next, other model sizes, non-AXQ packs, and other publishers are excluded from managed local selection. Each selected repository appears once. Configured aliases and older cached revisions do not add choices after discovery. Qwen3.8 27B AXQ 6-bit MTP remains the default. Other providers and the existing separately configured loopback attach interface retain their behavior.

## Inspect the available models

```bash
ax-code providers ax-engine models --json
ax-code providers ax-engine models --refresh --json
```

Refreshing reads Hugging Face metadata without downloading weights or starting a model. The bundled metadata works offline and supplements selected repositories missing from older caches. Present revisions are not silently replaced with a different bundled revision. Selection still requires valid source metadata; the repository restriction does not establish native capability.

`GET /provider/ax-engine/models` returns the running CLI's catalog, including each model's exact ID, repository, quantization, local state, memory/disk estimates, and verification status. An external GUI uses this runtime API. If it shows an older list, check the CLI it launches and its version. AX Coder development can select a source runtime with `AX_CODE_BINARY` or `settings.axCodeBinary`.

## Prepare a selected model

Copy the exact model ID from the catalog. For a pinned variant such as 4-bit MTP, retain its 40-character commit:

```bash
ax-code providers ax-engine prepare \
  --model 'AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP@<40-character-commit>' \
  --quantization mlx --download --start
```

`mlx` selects that exact published artifact; it does not requantize weights. Pinned downloads require AX Engine 6.13.1 or later. The default 6-bit MTP alias retains `mlx6bit`:

```bash
ax-code providers ax-engine prepare \
  --model qwen3.8-27b-axq-6bit --quantization mlx6bit --download --start
```

Excluded models fail new prepare, download, and managed activation requests before starting work. Existing model records remain available for status and cleanup; removed Ornith and Qwen3-Coder-Next IDs are never redirected to a Qwen3.8 27B artifact. Removing an option does not delete its weights or stop an existing server.

## Memory and runtime verification

The default Qwen3.8 27B 6-bit MTP alias budget remains 65,536 context tokens and 16,384 output tokens, with a 64 GiB memory requirement.

The other seven variants use the pinned-artifact policy: at most 32,768 context tokens and 8,192 output tokens, bounded by package metadata. Each memory estimate includes weights, sidecars, KV cache, buffers, and host reserve. Use the live catalog's fit result for the current machine. These estimates are not hardware or model-quality certification.

Before managed activation, AX Code checks the active AX Engine model's text and structured tool contract. A `verification-required` state means preparation is complete but that live contract has not been established. Repository names or MTP sidecars alone do not prove reasoning, vision, MTP acceleration, or multi-turn coding quality.

Session compaction uses the active model's context/output budgets and reserves input headroom. Each selected variant keeps its own catalog budget; the source model's maximum context is not a managed memory guarantee.

See [Local Engine Architecture](../architecture/local-engine.md) for lifecycle and transport details.
