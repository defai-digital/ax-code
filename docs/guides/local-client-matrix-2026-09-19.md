# AX Code and OpenCode client retest: 19 September 2026

Status: Active

Scope: measured diagnostic snapshot

Last reviewed: 2026-09-19

Owner: ax-code runtime

This retest uses AX Code source `62895cf40a39e0ebd4afec0afa21044e9871aa0b`, after the local
prefix fix (`42908b46a`) and MTPLX/oMLX provider additions. All six client/backend combinations
use the same **Qwen3.8 27B AXQ 6-bit artifact with MTP enabled** on an **Apple M3 Max, 128 GiB**.
The [earlier measurements](local-inference-results-2026-09-19.md) remain historical evidence;
their model packages, prompts, token limits and cache conditions differ. This is not a controlled
before/after estimate of the prefix fix's speedup.

## Delivered output speed

Each cell is **first task / repeated task**, in tokens/s. These are single observations, not medians.
The repeated task starts a new CLI session against the same backend process; it is not assumed to
hit a cache. Loading and waiting for the first output are excluded from this rate.

| Client   |     AX Engine |         MTPLX |          oMLX |
| -------- | ------------: | ------------: | ------------: |
| AX Code  | 11.73 / 13.60 | 18.73 / 19.69 | 17.48 / 16.60 |
| OpenCode | 22.49 / 18.98 | 27.91 / 26.35 | 20.33 / 20.64 |

The estimate is `(completion tokens - 1) / (last output payload time - first output payload time)`.
Speculative decoding can emit several tokens in one payload, so this is a client delivery estimate,
not the backend's native decode counter. It also does not measure complete-request throughput.

## Request timing, workload and acceptance

`NR` means the server did not report cached-token usage; it does not assert zero. First-payload time
starts when the local recording proxy receives the model request. CLI wall time also includes client
startup and completion. The task asks for a standalone generic TypeScript LRU cache with `get`, `set`,
`delete` and `clear`, without tool execution or file edits.

| Backend   | Client   | Task   | Input tokens | Output tokens | Cached tokens | First payload (s) | CLI wall (s) | Code checks |
| --------- | -------- | ------ | -----------: | ------------: | ------------: | ----------------: | -----------: | ----------- |
| AX Engine | AX Code  | First  |       29,896 |           268 |            NR |            197.78 |       231.58 | Pass        |
| AX Engine | AX Code  | Repeat |       29,896 |           268 |         29696 |              7.22 |        33.34 | Pass        |
| AX Engine | OpenCode | First  |       17,316 |           216 |            NR |            100.86 |       112.83 | Pass        |
| AX Engine | OpenCode | Repeat |       17,316 |           228 |            NR |            116.03 |       129.90 | Pass        |
| MTPLX     | AX Code  | First  |       36,708 |           285 |             0 |            246.67 |       269.43 | Pass        |
| MTPLX     | AX Code  | Repeat |       36,708 |           285 |         36708 |              0.04 |        20.48 | Pass        |
| MTPLX     | OpenCode | First  |       18,729 |           276 |             0 |            108.67 |       121.00 | Pass        |
| MTPLX     | OpenCode | Repeat |       18,729 |           276 |         18729 |              0.08 |        12.77 | Pass        |
| oMLX      | AX Code  | First  |       33,124 |           275 |             0 |            212.25 |       235.62 | Pass        |
| oMLX      | AX Code  | Repeat |       33,124 |           232 |         32768 |              4.41 |        23.34 | Pass        |
| oMLX      | OpenCode | First  |       17,316 |           213 |             0 |            118.03 |       130.88 | Pass        |
| oMLX      | OpenCode | Repeat |       17,316 |           261 |         16384 |              7.73 |        22.91 | Pass        |

Code acceptance checks missing keys, value lookup, LRU eviction, retained entries, update recency,
deleting existing and absent keys, clearing, object-key identity and falsy values. Generated files
also receive strict TypeScript checking. These bounded checks do not establish broad coding quality.
All measurement rows retain their generated output and validation result; failures are not silently
replaced with faster retries.

## MTP and runtime conditions

- AX Engine 7.4.0: `--mlx-mtp-policy required`, managed local runtime flags, n-gram acceleration and
  n-gram stacking disabled. Live process metrics show `ax_engine_mlx_mtp_model_policy_active=1`
  with nonzero draft and accepted token counters. The AX Code snapshot follows warmup; the OpenCode snapshot follows the first task. Both include
  warmup and are not per-task acceptance totals. Per-task AX Code draft counts were not retained.
- MTPLX 2.11.3 / MLX 0.32.2: explicit `--generation-mode mtp --depth 3`; live health reports
  `generation_mode: mtp` and `runtime_mode: Sustained MTP`. Agent rewrites and SSD session cache
  are off; the native in-memory session bank remains enabled. Native startup/kernel warmups are retained and excluded from timing. The unrelated load warmup completed;
  background warmup status at admission is retained in the data rather than assumed complete.
- oMLX 0.6.4 / MLX 0.32.0: Lightning MTP enabled, depth 3, text-only model loading, concurrency one.
  Per-generation logs record draft acceptance and per-depth execution for warmup and both tasks.
  The upstream sidecar importer renames 15 tensors; their dtype, shape and payload bytes remain
  identical to the original AXQuant sidecar. Backbone weights are unchanged.
- Artifact: `AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP`, revision
  `4d36d652c21590f6813495351c3baf5fca5b3831`. The artifact metadata declares MTP depth 1;
  recurrent depth 3 here follows the selected runtime policy/explicit experiment and does not
  extend artifact certification. The Optimized-Speed model package is not used in this retest.
- OpenCode version is 1.18.31. All backends and clients run serially. Each client/backend pair starts
  a fresh process and isolated task cache, followed by an unrelated model-load warmup capped at 64 output tokens.
  Model loading and that warmup are excluded from the table; the first task still pays cold prefill.
  Fan control is left at its default, and backbone files reside on SMB storage.

## What is aligned, and what remains different

Both clients receive the same frozen full project instructions, user task and four permitted tools
(`glob`, `grep`, `read`, `skill`). The source AX Code CLI uses the actual `ax-engine`, `mtplx` and
`omlx` provider IDs; AX Engine uses its verified loopback attachment contract with a separately
started backend carrying managed flags. This does not time the managed download/startup UI.
OpenCode uses its OpenAI-compatible provider path. Project configuration is disabled and each
client has isolated settings/state. Native client prompts, tool schemas and session headers remain
intact; therefore rendered token counts and cache behavior differ.

A local recording proxy aligns temperature 0.55, top-p 1, top-k/min-p 0, repetition penalty 1,
presence/frequency penalties 0, seed 0, thinking off, and an output ceiling of 1,024 tokens.
It forces `tool_choice: none` for this no-tool task. Both clients are configured for a 65,536-token
context. Every row is checked for the complete instruction snapshot, the four tool names,
common sampling, one request, successful CLI exit, natural stop and no tool execution.

The longer AX Code prompts can increase both prefill and attention work during generation.
Different response lengths, content, runtime templates, kernels and cache policies prevent treating
these tables as an equal-token client-overhead benchmark. MTP being active does not guarantee
30–40 tokens/s for a full coding context. To isolate client overhead or a prefix-fix effect, replay
identical serialized requests/token IDs with controlled output and cache conditions separately.

This report changes no cloud, private GPU, CLI-provider or AX Trust behavior. See the
[local runtime setup guide](../providers/local-mlx-runtimes.md) for connection instructions and the
[sanitized measurement data](../data/local-client-matrix-2026-09-19.json) for exact timings, counts,
hashes, validation results and MTP evidence. Private project instructions, model responses, local
paths and session headers are retained locally and are not published. Consequently, the complete
private-context workload is not independently reproducible from the public report alone.
