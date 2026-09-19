# Local inference measurements: 19 September 2026

Status: Active

Scope: measured diagnostic snapshot

Last reviewed: 2026-09-19

Owner: ax-code runtime

These measurements investigate local response latency and decode speed on one **Apple M3 Max with
128 GiB unified memory**. They are not a hardware qualification, model-quality evaluation, or a promise
of 30–40 tokens/s at arbitrary context lengths. MTPLX and oMLX connection instructions are in the
[local runtime guide](../providers/local-mlx-runtimes.md).

## Conditions and timing

- AX Code source based on v7.19.3; OpenCode 1.18.31; AX Engine 7.4.0; MTPLX 2.11.3; oMLX 0.6.4
  (`1d7826185c5b5b69b38b27cbe57d7597b7551fd7`, isolated source installation).
- One inference backend at a time. Default fan control; no maximum-fan claim. Model files resided on
  SMB storage. MTPLX's exact-artifact run staged only the MTP sidecar on SSD, with its SHA-256 verified.
- Exact-artifact replays used `AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP`, revision
  `4d36d652c21590f6813495351c3baf5fca5b3831`. The separate MTPLX Optimized-Speed client runs used
  `Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed`. Those are different model packages, even though
  their total file sizes are similar; their rates cannot isolate a runtime-only speedup.
- Common replay settings: temperature 0.55, top-p 1, top-k 0, seed 0, up to 256 generated tokens.
  AX Engine and MTPLX used active MTP depth 3. Runtime kernels and speculative samplers differ.
  The artifact metadata declares depth 1; depth 3 here is an explicit runtime experiment, not an
  extension of the artifact's certification or a new default recommendation.
  AX Engine ignored EOS for its fixed-output native replay; MTPLX and oMLX follow their own stop rules.
- **Native decode rate** uses backend decode counters. **Delivered rate** is
  `(reported completion tokens - 1) / (last output payload time - first output payload time)`;
  empty events and keepalives do not count as output. These boundaries are not identical.
- **First-payload latency** includes request preparation on the server, cache restore/prefill, and any
  buffering before output. Total tokens divided by the entire request is a different throughput measure.
  Tool-call bursts are not suitable for first-to-last-payload decode estimates.

For example, the same MTPLX 30k-input replay measured **13.99 native decode tokens/s** but only
**1.13 tokens/s over the complete request**, because cold prefill consumed about 209 seconds.
A low whole-request number alone does not establish a decode-engine failure.

## Exact-weight AX Engine and MTPLX replay

Each pair received the same integer input token sequence and emitted 256 tokens. Values below are
single observations; generated token identities can differ despite a common seed.

| Input         | AX Engine native decode | MTPLX native decode | AX Engine cached input | MTPLX cached input |
| ------------- | ----------------------: | ------------------: | ---------------------: | -----------------: |
| 62 tokens     |               39.12 t/s |           39.48 t/s |           not reported |                  0 |
| 18,643 tokens |               17.49 t/s |           20.93 t/s |                      0 |                  0 |
| 30,019 tokens |               16.06 t/s |           13.99 t/s |                 29,696 |                  0 |

MTPLX used its Sustained profile for this artifact. The 30k AX Engine request was warm while MTPLX
was cold, so their first-token times cannot establish a prefill speed ratio. The 30k input includes a
historical step-limit instruction and produces diagnostic prose; it is not coding-task acceptance.
The 18,643-token MTPLX replay reported `stop` after 256 tokens rather than `length`.

The short prompt shows similar decode rates. These runs do not demonstrate that either backend is
universally faster, or that switching AX Code to another backend guarantees a fixed speedup.

## AX Code and OpenCode on MTPLX Optimized-Speed

Both clients received the same user task, full project instructions, and four permitted tool schemas.
The task requested a TypeScript LRU cache without executing tools. Client-specific prompts were retained;
a recording proxy aligned sampling, disabled thinking, and used a 1024-token request/server ceiling.
The following responses completed normally:

| Client           | Input tokens | Output tokens | Delivered rate | First payload | Cached input |
| ---------------- | -----------: | ------------: | -------------: | ------------: | -----------: |
| AX Code          |       36,808 |           277 |      23.92 t/s |      280.05 s |        2,048 |
| OpenCode, first  |       18,703 |           228 |      26.82 t/s |      122.54 s |            0 |
| OpenCode, repeat |       18,703 |           228 |      30.01 t/s |       0.018 s |       18,703 |

These measurements precede AX Code's local prefix fix (`42908b46a`). AX Code sent more context and
produced different code. This is not an equal-token client-overhead comparison or a before/after result.
Removing only the automatically scanned directory map in a separate replay reduced input to 30,717
but improved observed decode by only about 2%; directory-map removal was not adopted.

A separate AX Engine adapter matrix observed AX Code at 9.44–11.56 delivered t/s with 33,225 input
tokens and OpenCode at 12.82–13.00 with 17,290. Prompt lengths, output content, cache state, and the
256-token output ceiling differ from the complete-response table above; do not combine these into
one backend speedup ratio.

## oMLX

The oMLX test uses the exact AXQ artifact and an isolated installation with MLX 0.32.0. All five
native-kernel import checks, including `qwen35_prefill` and `decode_fast`, passed. Text-only loading
is selected explicitly, the context window is 65,536, and concurrency is one.

The initial Lightning MTP attempt returned HTTP 409 because the test skipped oMLX's required
**Import MTP side-car** step. This was a setup error, not missing AXQuant support. AXQuant already
provided the canonical `qwen3-next-mtp` contract; the current Hub revision
`b0784088d4026ca569c5653e6e6243c501ef5fa9` also includes `axquant_omlx_compat.json` listing
15 MTP tensors. The original replay snapshot predates that annotation.

The MTP-off baseline completed with the original artifact:

| Input tokens | Output tokens | Native decode | Delivered estimate | Cached input |
| -----------: | ------------: | ------------: | -----------------: | -----------: |
|           62 |           256 |     18.97 t/s |          18.90 t/s |            0 |
|       18,643 |           256 |     13.02 t/s |          12.97 t/s |            0 |
|       30,019 |           256 |     12.15 t/s |          12.10 t/s |            0 |

These are **MTP-off** results and must not be compared with MTP-on runtimes as evidence of an
inherent backend speed difference. Tokenizer round trips and server prompt counts matched the
integer inputs used by the other replay backends.

The corrected MTP run uses oMLX's own importer on a separate writable copy. Backbone shards are
unchanged. The importer adds `language_model.` to the 15 sidecar tensor names; each tensor's dtype,
shape, and payload hash was verified equal before and after import. The imported file hash therefore
differs because its header changed. Original metadata and the shared model snapshot remain intact.
MTP depth 3 is selected explicitly, and per-depth draft/accept counters confirm actual execution.

| Input tokens | Output tokens | MTP native decode | Delivered estimate | Draft acceptance | Cached input |
| -----------: | ------------: | ----------------: | -----------------: | ---------------: | -----------: |
|           62 |           256 |         31.12 t/s |          31.02 t/s |  179/195 (91.8%) |            0 |
|       18,643 |           256 |         17.18 t/s |          17.13 t/s |  177/192 (92.2%) |            0 |
|       30,019 |           256 |         15.19 t/s |          15.15 t/s |  170/199 (85.4%) |            0 |

The short result confirms that this AXQuant pack works with oMLX Lightning MTP after import.
Long-context decode remains slower despite active MTP. Different generated text, runtime versions,
kernels, and speculative policies prevent attributing all cross-runtime differences to AX Code.

## Coding-flow acceptance and exclusions

After the local prefix fix, AX Code completed an isolated read-only task on both AX Engine and MTPLX:
read a directory and two TypeScript files, explain the queue-full exception, identify capacity 7,
and return a marker available only in the second file. Both exited successfully and preserved the
fixture bytes. Subsequent AX Engine calls reused 11,264 input tokens; MTPLX reused 11,264–12,032.
The first request bodies were identical, but runtime templates produced different token counts.
This verifies the tool flow and observed cache reuse, not a fixed speedup from the patch.

The new provider IDs also passed live acceptance from the source CLI: `omlx` with the imported AXQ
pack and explicit `tool_call: true`, and `mtplx` with the Optimized-Speed pack and no configured model
entries. MTPLX discovered its chat model and tool capability from the native model listing. Both runs
completed two successful file reads and returned the expected exception, capacity, and file-only marker
without changing fixture bytes. The initial system/user prefix remained identical across each run's
three requests. oMLX reused 8,192 tokens; MTPLX reused 11,829 and 12,047 tokens. These are functional
checks, not matched performance runs; no cross-runtime wall-time speedup is claimed.

Earlier 256-token-capped AX Code responses were truncated and entered recovery; their repeated-output
rates around 51–58 t/s are excluded from fresh-generation claims. Initial runs with unequal project
instructions or tool permissions are also excluded. Ollama and LM Studio were inspected for request
construction only; no generation-rate result is claimed for them.

The generic 62-token prompt is public as an [exact oMLX completion request](../data/local-inference-short-request.json).
From the checkout root, after importing the sidecar, enabling MTP, and warming the model, it can be sent with:

```sh
curl --no-buffer http://localhost:8000/v1/completions \
  -H 'Content-Type: application/json' \
  --data-binary @docs/data/local-inference-short-request.json
```

Change the request's model ID to the ID exposed by your server. The file includes the rendered template;
use the completions endpoint so a chat template is not applied a second time. Confirm 62 prompt tokens
and retain the final usage event. Cold model loading and warmup must be reported separately.

Private project instructions, session prompts, local paths, and authentication details are not published.
The [sanitized measurement data](../data/local-inference-2026-09-19.json) contains counts, timing, runtime identity, and input hashes rather than
prompt text. The full private-context replay is therefore not a standalone publicly reproducible workload.
For a new comparison, use the same model revision, tokenizer/template, input IDs, output/stop rules,
sampling, MTP mode, cache state, hardware, and serial execution; report complete-task success separately.

Upstream contracts: [MTPLX server and model guide](https://github.com/youssofal/MTPLX),
[oMLX 0.6.4](https://github.com/jundot/omlx/tree/v0.6.4). Their published benchmarks use other
hardware and workloads and are not substituted for the measurements here.
