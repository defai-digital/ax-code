# Tiel Coder native prefill and decode measurements

Status: Measured local snapshot
Date: 2026-09-19
Scope: AX Code's two selected Tiel packs, AX Engine versus MTPLX

The new Tiel packs ran with active MTP on both tested runtimes. AX Engine's source build reached 47.36–58.53 decode tokens/s across the four cases; MTPLX reached 92.13–96.26. Prefill was approximately 1,190–1,446 tokens/s. These are native inference phase measurements on an Apple M3 Max with 128 GiB, not AX Code or OpenCode end-to-end coding throughput.

**Build requirement:** the installed Homebrew AX Engine 7.4.0 failed to start Tiel with `Engine(MlxMtpRequiredButUnavailable)`. The AX Engine results below use an optimized local build of commit `51137c71a6794964d52c32c95e275c0923ed8d0b`, which adds the Tiel MTP namespace loader fix. That build still identifies itself as 7.4.0. Its results do not establish support in the existing Homebrew binary or a published release. MTP remained required; no fallback run with MTP disabled is included.

## Results

Each value is the median of three trials. All trials generated exactly 256 tokens and reported zero cached input tokens. Prefill and decode both use tokens per second.

| Model                     | Input tokens | AX Engine prefill | AX Engine decode | MTPLX prefill | MTPLX decode |
| ------------------------- | -----------: | ----------------: | ---------------: | ------------: | -----------: |
| Tiel Coder, short         |          458 |          1,255.61 |            57.03 |      1,207.01 |        92.27 |
| Tiel Coder, context       |        3,182 |          1,424.24 |            55.25 |      1,279.48 |        96.26 |
| Cyber-Tiel Coder, short   |          483 |          1,226.86 |            58.53 |      1,189.60 |        95.09 |
| Cyber-Tiel Coder, context |        3,207 |          1,446.19 |            47.36 |      1,427.62 |        92.13 |

The decode difference exists in direct runtime requests with matched inputs, before AX Code's agent loop. This local comparison therefore locates a runtime-level difference; it does not identify a single kernel or policy as the cause. Prefill is much closer between these configurations. No MTP-disabled control was run, so this is not a measurement of MTP speedup.

[Sanitized inputs, all 24 trial receipts, phase counters, model revisions, and client acceptance results](data/tiel-runtime-phases-2026-09-19.json) accompany this report.

## Exact artifacts and environment

| Model                       | Hugging Face repository                                                                                                                     | Revision                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Tiel Coder, AX Code default | [AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP](https://huggingface.co/AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP)             | `5ab39b24bfd7f65203be9b7823b1840486f58b6d` |
| Cyber-Tiel Coder            | [AutomatosX/AX-Cyber-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP](https://huggingface.co/AutomatosX/AX-Cyber-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP) | `fe05e871ec69ad9ae8eac01fd285555514ac7daf` |

- AX Code source: `205cb556b`; selection uses `mlx` and the publisher's MXFP4 weights.
- Host: Apple M3 Max, 137,438,953,472 bytes of memory; macOS 27.0, build `26A428`.
- AX Engine: release-profile build of `51137c71a6794964d52c32c95e275c0923ed8d0b`, MLX 0.32.2. Server SHA-256: `1fbe7fc50ea16448f98350616273214c0475bffb3ef509fceb3f8849163e97f5`.
- MTPLX: 2.11.3, MLX 0.32.2, Python 3.12 environment.
- Both runtimes read each model's same shared Hugging Face snapshot. Model download, weight loading, and server startup are excluded from phase timings.

The packs are development requantizations. These tests do not certify model quality, numerical parity, long-context behavior, other hardware, or performance of a future release. They do not replace the historical [Qwen3.8 real-client matrix](local-client-matrix-2026-09-19.md), which used different models and measured a different boundary.

## Measurement method

The prompt asks for a generic TypeScript LRU cache and tests, preceded by 8 or 96 synthetic TypeScript functions. The messages are stored in the JSON receipt. Each model's pinned tokenizer renders its official chat template with `enable_thinking=false` and `add_generation_prompt=true`. Its resulting integer tokens are sent unchanged to both backends. AX Engine's `/tokenize` output was also checked against those IDs. Cyber-Tiel's template adds identity text, accounting for its additional 25 tokens; cross-backend inputs match within each model.

Requests use temperature 0.55, top-p 1, top-k 0, seed 0, and a 256-token limit. Each backend receives an explicit 64-token warmup before its measured trials. MTPLX also performs its normal startup/background warmup. A warmup does not count as a trial. The run order was MTPLX/Tiel, AX Engine/Tiel, MTPLX/Cyber-Tiel, AX Engine/Cyber-Tiel. Only one inference backend was active at a time; compilation finished before measured trials began. This small fixed-order sample is not an endurance or counterbalanced thermal study.

AX Engine uses native `/v1/generate` with `input_tokens` and `max_output_tokens`. MTPLX uses streamed `/v1/completions` with an integer-array `prompt`, followed by `/metrics`. These avoid differences in client prompt assembly and chat-template rendering between the two servers. The capped output is a throughput workload, not a complete-code correctness test.

| Measurement      | AX Engine                                                                                            | MTPLX                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Prefill duration | `ax_mlx_prefill_wall_us / 1e6`                                                                       | `prompt_eval_time_s`                                                               |
| Prefill rate     | Uncached input tokens / prefill duration                                                             | `prefill_compute_tok_s`, audited against `new_prefill_tokens / prompt_eval_time_s` |
| Decode duration  | `ax_mlx_decode_wall_us / 1e6`                                                                        | `decode_elapsed_s`                                                                 |
| Decode rate      | `(output_tokens - 1) / decode duration`; first output belongs to prefill                             | `decode_tok_s`, audited against `completion_tokens / decode_elapsed_s`             |
| Cache evidence   | Prefix cache disabled with `AX_MLX_PREFIX_CACHE_MAX_ENTRIES=0`; zero reused tokens                   | SSD session cache off; zero cached tokens on every completion                      |
| MTP evidence     | Required policy, active model drafter, positive accepted tokens, zero reported direct fallback steps | `generation_mode=mtp`, depth 3, positive draft and acceptance counters             |

The native decode counters have slightly different first-token boundaries; they are reported with their actual formulas rather than relabeled as identical timers. Neither rate divides output by total HTTP request duration. MTPLX's native TTFT is retained in the JSON; AX Engine's non-streaming probe does not measure transport TTFT.

## Runtime configuration

AX Engine used the generic `agentic` speculation profile, a 32,768-token context, 8,192-token advertised output budget, scheduler width 2,048, and one concurrent request. The dense Qwen3.8-specific AX Code environment overrides were not applied. Its admitted MTP depth was 3; the engine's normal draft gates remained active.

Equivalent launch arguments, with `SNAPSHOT` set to the appropriate pinned snapshot and `MODEL` to its AX Code alias:

```sh
AX_MLX_PREFIX_CACHE_MAX_ENTRIES=0 /path/to/fixed/ax-engine-server \
  --host 127.0.0.1 --port 18439 --model-id "$MODEL" \
  --mlx --mlx-model-artifacts-dir "$SNAPSHOT" \
  --mlx-mtp-policy required --speculation-profile agentic \
  --mlx-mtp-disable-ngram-stacking --max-concurrent-requests 1 \
  --max-batch-tokens 2048 --max-output-tokens 8192 \
  --block-size-tokens 16 --total-blocks 2048

mtplx serve --model "$SNAPSHOT" --model-id "$MODEL" \
  --host 127.0.0.1 --port 18442 --no-auth --agent-rewrites off \
  --max-tokens 8192 --context-window 32768 --reasoning off \
  --no-stats-footer --ssd-session-cache off --warmup-tokens 64 \
  --strict-warmup --fan-mode default --generation-mode mtp --load-mtp --depth 3
```

MTPLX used an empty isolated configuration. AX Engine model manifests were prepared with its pinned, local-only downloader; the publisher's model weights and MTP tensors were retained. Neither configuration disabled MTP to obtain a result.

## AX Code tool acceptance

A separate AX Code source run asked each model to read `probe.txt` with the read tool and return only its contents. State and configuration were isolated. AX Engine used explicit loopback attachment to the tested source server. These runs are excluded from the native phase table.

| Model      | Runtime          | Completed read | Correct marker in final answer | Exact output-only format         |
| ---------- | ---------------- | -------------- | ------------------------------ | -------------------------------- |
| Tiel       | AX Engine source | Yes            | Yes                            | No; added prose and a code fence |
| Tiel       | MTPLX            | Yes            | Yes                            | Yes                              |
| Cyber-Tiel | AX Engine source | Yes            | Yes                            | No; added prose and a code fence |
| Cyber-Tiel | MTPLX            | Yes            | Yes                            | Yes                              |

All four client processes exited successfully and completed a real read call. The two AX Engine runs failed the stricter output-format requirement, so this is not an all-green behavioral or coding-quality certification. Their prompts, tool payloads, default sampling, and chat handling are client/runtime paths, distinct from the matched-token phase benchmark. No cloud, CLI, private GPU, or AX Trust behavior was adjusted for these tests.

A separate managed `providers ax-engine start` invocation omitted the model argument and selected `tiel-coder-35b-axq-mxfp4` at the pinned revision with `mlx`. Its live status reported tool support, required/required MTP policy, active MTP, 27 drafted tokens and 23 accepted tokens. The managed server was then stopped successfully. This used isolated AX Code state and the existing helper's `AX_ENGINE_SERVER=/absolute/path/to/fixed/ax-engine-server` override; the user's installed binary and provider configuration were not replaced. The same override can be set when starting `pnpm run dev` with a build containing the loader fix.

The catalog change passed 11,374 deterministic tests, with 17 skipped, plus 208 SDK tests, 259 script tests (94 skipped), recursive typecheck, repository structure checks, and TUI checks. See [model selection and runtime requirements](../providers/ax-engine-model-selection.md) before using the new default.
