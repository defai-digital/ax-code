# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-08-18
Owner: ax-code runtime

AX Code can use AX Engine as a local provider on eligible Apple Silicon Macs. This page explains the
model-selection policy for the built-in `ax-engine` provider: which local models are surfaced, why the
default is conservative, and how to choose a model by memory budget.

Integration shape (sidecar HTTP, not in-process SDK): see
[Local Engine Architecture](../architecture/local-engine.md).

The current AX Code provider list is intentionally narrower than the full AX Engine research or benchmark
matrix. In this checkout it exposes curated AutomatosX AXQ 6-bit MLX packs.

## Single source of truth

| Layer                                                                                                                | Role                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`packages/ax-code/src/provider/ax-engine/constants.ts`](../../packages/ax-code/src/provider/ax-engine/constants.ts) | **Only** place that defines built-in model ids, HF repos, disk/memory floors, and download mode           |
| `GET /provider/ax-engine/models`                                                                                     | Serves that catalog from the **running ax-code process** (includes `catalog.source` + `catalog.modelIDs`) |
| Desktop Models UI                                                                                                    | Displays whatever the live API returns — it does not embed a second model list                            |

If Desktop shows an old list, the managed session is almost always spawning an older installed CLI
(Homebrew/PATH) rather than this checkout. `pnpm run desktop:dev` prefers a monorepo source launcher over
PATH installs so local catalog edits appear without `setup:cli`. Override with `AX_CODE_BINARY` or
`settings.axCodeBinary` when you intentionally want another runtime.

## Selection Criteria

AX Code ranks local AX Engine models by practical agent usability, not by a single benchmark:

1. **Offline coding quality** - patch planning, code editing, repository reasoning, and tool-use reliability.
2. **Reasoning headroom** - ability to maintain longer multi-step work without drifting.
3. **Local fit** - unified-memory pressure, disk footprint, cold-start cost, and decode comfort on Apple Silicon.
4. **Tool workflow compatibility** - OpenAI-compatible structured tool calling and AX Code session behavior.
5. **Operational default safety** - a default should work for broad daily coding, not only benchmark runs.

## Built-In Model Order

| Rank | AX Code model id            | Model                      | Local role                   | Catalog limits (context / output) |
| ---: | --------------------------- | -------------------------- | ---------------------------- | --------------------------------: |
|    1 | `qwen3.8-27b-axq-6bit`      | Qwen3.8-27B AXQ 6-bit      | Default daily driver         |                   65,536 / 16,384 |
|    2 | `ornith-35b-axq-6bit`       | Ornith-1.0-35B AXQ 6-bit   | Long-context reasoning model |                  262,144 / 32,000 |
|    3 | `qwen3-coder-next-axq-6bit` | Qwen3-Coder-Next AXQ 6-bit | Large coding specialist      |                   32,768 / 16,384 |

`qwen3.8-27b-axq-6bit` is the default. Its packaged AXQuant MTP snapshot is the smallest current built-in
download (about 19.4 GiB), and the catalog reserves a 16,384-token output budget inside its 65,536-token window.

Ornith-1.0-35B is the reasoning and long-context choice. Qwen3-Coder-Next is the largest coding-specialist
artifact and requires the 96 GB memory tier, so neither replaces Qwen3.8-27B as the broad default.

## Acquisition and acceleration

All built-in models use direct Hugging Face downloads via `ax-engine download`:

- `qwen3.8-27b-axq-6bit` — [AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP)
  (native `model-manifest.json` plus `axquant_mtp_sidecar_manifest.json`)
- `ornith-35b-axq-6bit` — [AutomatosX/AX-Ornith-1.0-35B-MLX-AXQ-6bit](https://huggingface.co/AutomatosX/AX-Ornith-1.0-35B-MLX-AXQ-6bit)
  (direct decode; ax-engine emits the native manifest after download)
- `qwen3-coder-next-axq-6bit` — [AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit](https://huggingface.co/AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit)
  (direct decode; ax-engine emits the native manifest after download)

At runtime the policy is automatic: a complete package with a valid assistant/sidecar uses MTP, while a complete
base snapshot without that marker remains runnable through direct decode. Standalone n-gram drafting is disabled
in the AX Code-managed server; it is independent from packaged MTP.

## Choose By Memory

These recommendations assume local AX Code usage through the built-in `ax-engine` provider. The current built-in
quantization is `mlx6bit`; lower-bit upstream deployments may have different memory requirements.

| Unified memory | Best built-in choice        | Second choice          | Notes                                                                                    |
| -------------: | --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
|       24-48 GB | Hosted provider             | None                   | The current built-in catalog has a 64 GB minimum; no small local fallback is advertised. |
|          64 GB | `qwen3.8-27b-axq-6bit`      | `ornith-35b-axq-6bit`  | Use the default MTP model, or Ornith when its larger context is the priority.            |
|         96 GB+ | `qwen3-coder-next-axq-6bit` | `qwen3.8-27b-axq-6bit` | Use the larger coding specialist when its 80 GiB disk reserve is acceptable.             |

## Practical Defaults

- Use **Qwen3.8-27B AXQ 6-bit** when you have 64 GB+ unified memory and want the default local daily driver.
- Use **Ornith-1.0-35B AXQ 6-bit** when long context and native reasoning matter more than packaged MTP.
- Use **Qwen3-Coder-Next AXQ 6-bit** on 96 GB+ machines when coding specialization matters more than context length.
- Prefer hosted providers or an OpenAI-compatible provider gateway on unsupported Macs, Windows, or machines that
  cannot keep the selected model resident comfortably. AX Code servers are local-only.

## References

- [AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP on Hugging Face](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP)
- [AX-Ornith-1.0-35B-MLX-AXQ-6bit on Hugging Face](https://huggingface.co/AutomatosX/AX-Ornith-1.0-35B-MLX-AXQ-6bit)
- [AX-Qwen3-Coder-Next-MLX-AXQ-6bit on Hugging Face](https://huggingface.co/AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit)
