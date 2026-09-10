# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-09-10
Owner: ax-code runtime

AX Code offers three model repositories through **AX Engine (Local)** on eligible Apple Silicon Macs:

| Model                       | Hugging Face repository                                                                                             | AX Code selection                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Ornith 1.5 9B AXQ 6-bit MTP | [AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP](https://huggingface.co/AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP) | Pinned `AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP@<commit>` |
| Qwen3.8 27B AXQ 6-bit MTP   | [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP)     | `qwen3.8-27b-axq-6bit`                                         |
| Qwen3-Coder-Next AXQ 6-bit  | [AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit](https://huggingface.co/AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit)   | `qwen3-coder-next-axq-6bit`                                    |

Other repositories and quantizations, including Ornith 1.0 35B, are excluded from managed local selection. Each repository appears once. Configured aliases and older cached revisions do not add choices after discovery. Qwen3.8 27B remains the default. Other providers and the existing separately configured loopback attach interface retain their behavior.

## Inspect the available models

```bash
ax-code providers ax-engine models --json
ax-code providers ax-engine models --refresh --json
```

Refreshing reads Hugging Face metadata without downloading weights or starting a model. The bundled metadata works offline and supplements selected repositories missing from older caches. Present revisions are not silently replaced with a different bundled revision. Selection still requires valid source metadata; the repository restriction does not establish native capability.

`GET /provider/ax-engine/models` returns the running CLI's catalog, including each model's exact ID, repository, quantization, local state, memory/disk estimates, and verification status. An external GUI uses this runtime API. If it shows an older list, check the CLI it launches and its version. AX Coder development can select a source runtime with `AX_CODE_BINARY` or `settings.axCodeBinary`.

## Prepare a selected model

Copy the exact model ID from the catalog. For Ornith 1.5 9B, retain its 40-character commit:

```bash
ax-code providers ax-engine prepare \
  --model 'AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP@<40-character-commit>' \
  --quantization mlx --download --start
```

`mlx` selects that exact published artifact; it does not requantize weights. Pinned downloads require AX Engine 6.13.1 or later. The two Qwen aliases retain `mlx6bit`:

```bash
ax-code providers ax-engine prepare \
  --model qwen3.8-27b-axq-6bit --quantization mlx6bit --download --start
```

Excluded models fail new prepare, download, and managed activation requests before starting work. Existing model records remain available for status and cleanup; the old Ornith ID is never redirected to Ornith 1.5 9B. Removing an option does not delete its weights or stop an existing server.

## Memory and runtime verification

The existing Qwen3.8 27B managed budget remains 65,536 context tokens and 16,384 output tokens, with a 64 GiB memory requirement. Qwen3-Coder-Next retains 32,768 context tokens and 16,384 output tokens, with a 96 GiB requirement.

Ornith 1.5 9B uses the pinned-artifact policy: at most 32,768 context tokens and 8,192 output tokens, bounded by package metadata. Its memory estimate includes weights, sidecars, KV cache, buffers, and host reserve. Use the live catalog's fit result for the current machine. These estimates are not hardware or model-quality certification.

Before managed activation, AX Code checks the active AX Engine model's text and structured tool contract. A `verification-required` state means preparation is complete but that live contract has not been established. Repository names or MTP sidecars alone do not prove reasoning, vision, MTP acceleration, or multi-turn coding quality.

Session compaction uses the active model's context/output budgets and reserves input headroom. It does not transfer the removed Ornith 35B model's 256K policy to Ornith 1.5 9B.

See [Local Engine Architecture](../architecture/local-engine.md) for lifecycle and transport details.
