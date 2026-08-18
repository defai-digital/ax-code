# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-08-10
Owner: ax-code runtime

AX Code can use AX Engine as a local provider on eligible Apple Silicon Macs. This page explains the
model-selection policy for the built-in `ax-engine` provider: which local models are surfaced, why the
default is conservative, and how to choose a model by memory budget.

Integration shape (sidecar HTTP, not in-process SDK): see
[Local Engine Architecture](../architecture/local-engine.md).

The current AX Code provider list is intentionally narrower than the full AX Engine research or benchmark
matrix. In this checkout it exposes curated AutomatosX AXQ 6-bit MLX packs.

## Single source of truth

| Layer | Role |
| --- | --- |
| [`packages/ax-code/src/provider/ax-engine/constants.ts`](../../packages/ax-code/src/provider/ax-engine/constants.ts) | **Only** place that defines built-in model ids, HF repos, disk/memory floors, and download mode |
| `GET /provider/ax-engine/models` | Serves that catalog from the **running ax-code process** (includes `catalog.source` + `catalog.modelIDs`) |
| Desktop Models UI | Displays whatever the live API returns — it does not embed a second model list |

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

| Rank | AX Code model id             | Model                       | Local role                  | Why it is placed there                                                                                         |
| ---: | ---------------------------- | --------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
|    1 | `qwen3-coder-next-axq-6bit`  | Qwen3-Coder-Next AXQ 6-bit  | Dedicated coding specialist | Best fit for repository editing and tool use on 96 GB+ hosts; direct decode with a memory-safe 32K context (256K-native model). |
|    2 | `qwen3.6-27b-axq-6bit`       | Qwen3.6-27B AXQ 6-bit       | Default daily driver        | Certified AutomatosX AXQ 6-bit + MTP snapshot; best practical balance for offline coding on 48-64 GB+ machines. |
|    3 | `qwen3.5-9b-axq-6bit`        | Qwen3.5-9B AXQ 6-bit        | Light local option          | Smallest AXQ pack (~8.4 GB); MTP sidecar; best fit when unified memory is tight.                               |

`qwen3.6-27b-axq-6bit` is the default because it is the safest daily recommendation for serious offline coding:
it has high coding and reasoning headroom, ships as a pre-packaged AXQuant snapshot (~21 GB download), and
avoids the operational cost of the largest specialist models.

Qwen3-Coder-Next AXQ is the strongest coding-specialist choice when the machine can hold its 6-bit 80B-A3B
artifact. It is not the default because its memory/disk footprint and 16K managed context are less practical for
the broad installed base than Qwen3.6-27B AXQ.

## Acquisition and acceleration

All built-in models use direct Hugging Face downloads via `ax-engine download`:

- `qwen3.6-27b-axq-6bit` — [AutomatosX/AX-Qwen3.6-27B-MLX-AXQ-6bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.6-27B-MLX-AXQ-6bit-MTP)
  (native `model-manifest.json` plus `axquant_mtp_sidecar_manifest.json`)
- `qwen3.5-9b-axq-6bit` — [AutomatosX/AX-Qwen3.5-9B-MLX-AXQ-6bit-MTP](https://huggingface.co/AutomatosX/AX-Qwen3.5-9B-MLX-AXQ-6bit-MTP)
  (`axquant_mtp_sidecar_manifest.json`; ax-engine emits the native manifest after download)
- `qwen3-coder-next-axq-6bit` — [AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit](https://huggingface.co/AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit)
  (direct decode; ax-engine emits the native manifest after download)

At runtime the policy is automatic: a complete package with a valid assistant/sidecar uses MTP, while a complete
base snapshot without that marker remains runnable through direct decode. Standalone n-gram drafting is disabled
in the AX Code-managed server; it is independent from packaged MTP.

## Choose By Memory

These recommendations assume local AX Code usage through the built-in `ax-engine` provider. The current built-in
quantization is `mlx6bit`; lower-bit upstream deployments may have different memory requirements.

| Unified memory | Best built-in choice         | Second choice               | Notes                                                                                   |
| -------------: | ---------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
|       24-32 GB | `qwen3.5-9b-axq-6bit`        | Hosted provider             | Lightest built-in option when local is required; prefer hosted for serious agent work.  |
|          48 GB | `qwen3.6-27b-axq-6bit`       | `qwen3.5-9b-axq-6bit`       | Usable if the machine can hold the 27B working set; fall back to 9B under pressure.     |
|          64 GB | `qwen3.6-27b-axq-6bit`       | `qwen3.5-9b-axq-6bit`       | Recommended default tier for local AX Engine work.                                      |
|         96 GB+ | `qwen3-coder-next-axq-6bit`  | `qwen3.6-27b-axq-6bit`      | Use the coding specialist when its larger download and working set are acceptable.      |

## Practical Defaults

- Use **Qwen3.6-27B AXQ 6-bit** when you have 48-64 GB+ unified memory and want one local daily driver.
- Use **Qwen3.5-9B AXQ 6-bit** on tighter memory budgets when a small local model is still useful.
- Use **Qwen3-Coder-Next AXQ 6-bit** on 96 GB+ machines when coding specialization matters more than context length.
- Prefer hosted providers or an OpenAI-compatible provider gateway on unsupported Macs, Windows, or machines that
  cannot keep the selected model resident comfortably. AX Code servers are local-only.

## References

- [AX-Qwen3.6-27B-MLX-AXQ-6bit-MTP on Hugging Face](https://huggingface.co/AutomatosX/AX-Qwen3.6-27B-MLX-AXQ-6bit-MTP)
- [AX-Qwen3.5-9B-MLX-AXQ-6bit-MTP on Hugging Face](https://huggingface.co/AutomatosX/AX-Qwen3.5-9B-MLX-AXQ-6bit-MTP)
- [AX-Qwen3-Coder-Next-MLX-AXQ-6bit on Hugging Face](https://huggingface.co/AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit)
