# AX Engine Model Selection

Status: Active
Scope: current-state
Last reviewed: 2026-07-11
Owner: ax-code runtime

AX Code can use AX Engine as a local provider on eligible Apple Silicon Macs. This page explains the
model-selection policy for the built-in `ax-engine` provider: which local models are surfaced, why the
default is conservative, and how to choose a model by memory budget.

Integration shape (sidecar HTTP, not in-process SDK): see
[Local Engine Architecture](../architecture/local-engine.md).

The current AX Code provider list is intentionally narrower than the full AX Engine research or benchmark
matrix. In this checkout it exposes curated 6-bit MLX variants, matching the model definitions in
[`packages/ax-code/src/provider/ax-engine/constants.ts`](../../packages/ax-code/src/provider/ax-engine/constants.ts).
Some upstream model cards also describe 4-bit or larger-context deployments; those are useful for planning,
but they are not the built-in AX Code provider contract unless the provider definitions add those
quantizations.

## Selection Criteria

AX Code ranks local AX Engine models by practical agent usability, not by a single benchmark:

1. **Offline coding quality** - patch planning, code editing, repository reasoning, and tool-use reliability.
2. **Reasoning headroom** - ability to maintain longer multi-step work without drifting.
3. **Local fit** - unified-memory pressure, disk footprint, cold-start cost, and decode comfort on Apple Silicon.
4. **Tool workflow compatibility** - OpenAI-compatible structured tool calling and AX Code session behavior.
5. **Operational default safety** - a default should work for broad daily coding, not only benchmark runs.

Benchmarks such as SWE-bench Verified, LiveCodeBench, GPQA, AIME, and tool-invocation suites are treated as
signals. They do not override local memory fit or observed agent behavior.

## Built-In Model Order

| Rank | AX Code model id        | Model                  | Local role                     | Why it is placed there                                                                                       |
| ---: | ----------------------- | ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
|    1 | `qwen3-coder-next-6bit` | Qwen3-Coder-Next 6-bit | Dedicated coding specialist    | Best fit for repository editing and tool use on 96 GB+ hosts; direct decode with a conservative 16K context. |
|    2 | `qwen3.6-27b-6bit`      | Qwen3.6-27B 6-bit      | Default daily driver           | Best practical balance for offline coding and reasoning on 48-64 GB+ machines.                               |
|    3 | `gemma-4-31b`           | Gemma 4 31B 6-bit      | High-quality dense alternative | Strong coding and reasoning signal when Gemma behavior is preferred over Qwen.                               |
|    4 | `glm-4.7-flash`         | GLM-4.7-Flash 6-bit    | Efficient MTP alternative      | 30B-A3B MoE design, strong public coding/tool benchmarks, and lower-memory fit than larger dense models.     |
|    5 | `qwen3.6-35b-a3b`       | Qwen3.6-35B-A3B 6-bit  | Reasoning-heavy MoE option     | Strong reasoning ceiling, but a less practical default than Qwen3.6-27B or GLM-4.7-Flash.                    |
|    6 | `gemma-4-26b`           | Gemma 4 26B-A4B 6-bit  | Mid-tier Gemma MoE option      | Useful when Gemma 31B is too heavy and Gemma 12B is too small.                                               |
|    7 | `gemma-4-12b`           | Gemma 4 12B 6-bit      | Small local fallback           | Best fit for smaller-memory machines and lightweight edits, with lower coding/reasoning headroom.            |

`qwen3.6-27b-6bit` remains the default because it is the safest daily recommendation for serious offline coding:
it has high coding and reasoning headroom without the operational cost of the largest specialist models.

GLM-4.7-Flash is now ranked above Qwen3.6-35B-A3B for low-RAM local coding-agent use. The reason is not that it
has the highest absolute coding ceiling; it is that its 30B-A3B MoE shape gives strong agent usefulness at a
lower local memory cost. Z.ai describes GLM-4.7 as focused on programming, tool invocation, and coding-agent
workflows, and its GLM-4.7-Flash model card reports SWE-bench Verified 59.2, LiveCodeBench v6 64.0, AIME 25
91.6, and GPQA 75.2. See the Z.ai GLM-4.7 overview and the GLM-4.7-Flash Hugging Face model card for the
upstream benchmark context.

Qwen3-Coder-Next is the strongest coding-specialist choice when the machine can hold its 6-bit 80B-A3B artifact.
It is not the default because its memory/disk footprint and 16K managed context are less practical for the broad
installed base than Qwen3.6-27B.

## Acquisition Paths

AX Code prepares Qwen3.6, Gemma 4, and GLM-4.7-Flash through `ax-engine download-mtp`, including GLM's built-in
MTP sidecar package. Qwen3-Coder-Next remains on the direct MLX path because it does not have a promoted MTP
package contract. AX Code validates each family-specific package marker before treating a model as runnable.

## Choose By Memory

These recommendations assume local AX Code usage through the built-in `ax-engine` provider. The current built-in
quantization is `mlx6bit`; lower-bit upstream deployments may have different memory requirements.

| Unified memory | Best built-in choice    | Second choice                            | Notes                                                                                                          |
| -------------: | ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
|          16 GB | `gemma-4-12b`           | Hosted provider                          | Use local AX Engine only for lightweight work. Hosted models are usually better for serious agent tasks.       |
|       24-32 GB | `gemma-4-12b`           | `glm-4.7-flash` if it fits your workload | Upstream 4-bit GLM-4.7-Flash is attractive here, but AX Code's built-in provider currently exposes 6-bit only. |
|          48 GB | `qwen3.6-27b-6bit`      | `glm-4.7-flash`                          | Best balance for local coding on smaller high-end machines.                                                    |
|          64 GB | `qwen3.6-27b-6bit`      | `gemma-4-31b` or `glm-4.7-flash`         | Recommended default tier for local AX Engine work.                                                             |
|         96 GB+ | `qwen3-coder-next-6bit` | `qwen3.6-27b-6bit` or `gemma-4-31b`      | Use the coding specialist when its larger download and working set are acceptable.                             |

## Practical Defaults

- Use **Qwen3.6-27B 6-bit** when you have 48-64 GB+ unified memory and want one local daily driver.
- Use **Qwen3-Coder-Next 6-bit** on 96 GB+ machines when coding specialization matters more than context length.
- Use **GLM-4.7-Flash** when local memory pressure matters and you still need coding-agent behavior.
- Use **Gemma 4 31B** when you want a strong dense Gemma alternative and have enough memory.
- Use **Gemma 4 12B** when the machine is memory constrained or the task is a small edit/review.
- Prefer hosted providers or an OpenAI-compatible provider gateway on unsupported Macs, Windows, or machines that
  cannot keep the selected model resident comfortably. AX Code servers are local-only.

## References

- [GLM-4.7-Flash on Hugging Face](https://huggingface.co/zai-org/GLM-4.7-Flash)
- [Z.ai GLM-4.7 overview](https://docs.z.ai/guides/llm/glm-4.7)
- [Gemma 4 model page in LM Studio](https://lmstudio.ai/models/gemma-4)
- [Google: Introducing Gemma 4 12B](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/)
