# Tiel MTP profile comparison

Status: Measured local snapshot
Last reviewed: 2026-09-19
Owner: AX Code maintainers
Scope: Native Tiel MTP profile measurements and managed AX Code acceptance

AX Code now selects the `auto` speculation profile for the default Tiel Coder pack, while keeping MTP activation `required`. Cyber-Tiel retains `agentic`: its `auto` candidate failed the real read-tool probe with repetitive output and subsequent concurrency-limit errors. This lets the engine use its model-specific draft gate. The previous generic `agentic` profile overrode that gate with 0.80. The native comparison improved Tiel decode in both measured workloads and Cyber-Tiel with longer input; Cyber-Tiel's short-input result regressed slightly. Higher native throughput did not establish usable tool behavior for that candidate.

These are direct AX Engine native phase measurements on an Apple M3 Max with 128 GiB, not AX Code task throughput. The [original AX Engine versus MTPLX report](tiel-runtime-phases-2026-09-19.md) remains the historical baseline. MTPLX was not rerun in this profile experiment, so its earlier 92–96 tokens/s results must not be treated as a simultaneous comparison.

## Confirmation results

Rates are tokens/s, each the median of three uncached 256-token completions. Model loading and the 64-token warmup are excluded. The host had other desktop applications active; this is a small local snapshot, not a controlled thermal or endurance study.

| Model               | Input tokens | Agentic prefill | Auto prefill | Agentic decode | Auto decode | Decode change |
| ------------------- | -----------: | --------------: | -----------: | -------------: | ----------: | ------------: |
| Tiel, short         |          458 |          795.40 |       830.19 |          47.60 |       54.69 |        +14.9% |
| Tiel, context       |        3,182 |          906.31 |       967.79 |          39.50 |       47.84 |        +21.1% |
| Cyber-Tiel, short   |          483 |        1,009.78 |     1,081.05 |          61.09 |       58.53 |         -4.2% |
| Cyber-Tiel, context |        3,207 |        1,220.00 |     1,211.88 |          46.91 |       54.70 |        +16.6% |

Only Tiel's `auto` profile is adopted. Cyber-Tiel's `auto` numbers remain experimental evidence, not its shipping default. The read-tool failure blocks promotion even though the longer-input phase rate improved; it does not establish that the profile alone caused the failure. Prefill fluctuated despite the same prefill configuration. Absolute rates also differ from the earlier report, which is why that historical baseline was not used to calculate these gains.

All 24 confirmation requests reported active MTP, positive accepted drafts, zero direct-fallback steps, and zero reused input tokens. The engine reported its sampled-exact route code (`ax_mtp_correctness_mode=2`); that runtime classification is not an independent numerical or quality certification.

[Sanitized inputs, phase counters, all confirmation and pilot receipts, and managed/tool acceptance](data/tiel-mtp-profile-2026-09-19.json) accompany this report.

## Single-variable pilots

One preliminary trial per case isolated the gate before the repeated comparison. Do not pool these pilots with confirmation trials.

| Tiel configuration                             | Short decode | Context decode | Active MTP |
| ---------------------------------------------- | -----------: | -------------: | ---------- |
| `agentic`, default environment                 |        56.52 |          56.94 | Yes        |
| `agentic`, `AX_MLX_MTP_DRAFT_MIN_CONFIDENCE=0` |        62.21 |          59.82 | Yes        |
| `auto`, default environment                    |        61.71 |          59.80 | Yes        |

In the context pilot, the explicit zero-gate and `auto` requests produced identical output tokens and draft/acceptance counts. The `auto` request's rollback timer fell from 1.061 s to 0.055 s and its draft timer from 0.718 s to 0.130 s. However, verification cycles increased from 78 to 111 and verification evaluation remained about 2.26 s. The total decode improvement was therefore much smaller than either timer reduction. These counters describe different execution paths; they are not independent, additive estimates of future speedups.

Two additional stochastic-draft pilots, with and without a 0.6 draft-temperature override, reported **inactive MTP**, 255 direct-fallback steps, and no drafts. The engine's protection selected the direct-fallback route. Their raw receipts are retained and explicitly excluded from the active-MTP comparison. AX Code does not adopt these overrides or bypass that protection.

## Reproduction and scope

Use the same engine build, pinned snapshots, prompt tokens, sampling parameters, and launch command as the [original measurement method](tiel-runtime-phases-2026-09-19.md#measurement-method), changing only `--speculation-profile agentic` to `--speculation-profile auto`. Confirmation requests had no additional MTP environment overrides. Prefix caching was disabled with `AX_MLX_PREFIX_CACHE_MAX_ENTRIES=0`. The native decode formula remains `(output_tokens - 1) / native_decode_seconds`; prefill is uncached input tokens divided by native prefill seconds.

The engine was an optimized source build of `51137c71a6794964d52c32c95e275c0923ed8d0b`, MLX 0.32.2, server SHA-256 `1fbe7fc50ea16448f98350616273214c0475bffb3ef509fceb3f8849163e97f5`. The tested Homebrew 7.4.0 binary predates the required Tiel namespace loader fix, although this source build also reports 7.4.0. No installed binary or user configuration was replaced.

Confirmation order was Tiel/auto, Tiel/agentic, Cyber-Tiel/agentic, Cyber-Tiel/auto. Each launch received one 64-token warmup, then three short and three context trials. Only one inference backend ran at a time; compilation and test suites were excluded from timed trials. Scheduler width remained 2,048, context 32,768, maximum output budget 8,192, and maximum concurrency 1. Real managed AX Code retains its existing scheduler width of 8,192, so the phase table does not establish its full client throughput.

The default change applies only to the exact AutomatosX Tiel Coder repository and its alias. Cyber-Tiel retains its previous `agentic` profile. Explicit launch-profile overrides still win. Dense Qwen3.8's experimental environment and prefix geometry remain separate; neither is applied to Tiel. Historical or unrecognized models retain their previous profile. Cloud, CLI, private GPU, and AX Trust provider behavior is unchanged.

## Managed and tool acceptance

Separate isolated source runs exercise default Tiel activation and explicit Cyber-Tiel activation, live required/active MTP, AX Code's `read` tool, and managed shutdown. Tiel with `auto` completed the read and returned the correct marker, but added prose and a code fence instead of returning only the file contents. Cyber-Tiel with `auto` repeated its intended action without completing a read, triggered the output-loop guard, received concurrency-limit 429 responses on subsequent retries, and exited with an error after about 81 seconds. The retained `agentic` control reproduced the same repetitive output and failed after about 84 seconds. Therefore this task failure is not isolated to `auto`; preserving the old profile does not claim to fix Cyber-Tiel. Both failures are retained alongside a separate cache-disabled diagnostic in the JSON receipt. These checks are separate from throughput timing and do not certify general coding quality.

The cache-disabled Cyber-Tiel diagnostic used `agentic` with only `AX_MLX_PREFIX_CACHE_MAX_ENTRIES=0` added. It exited successfully but did not invoke `read` and incorrectly claimed the nonempty fixture was empty. Process success alone therefore did not satisfy task acceptance. This diagnostic is not adopted as a workaround.

| Managed probe                         | Completed read | Correct marker | Outcome                                        |
| ------------------------------------- | -------------- | -------------- | ---------------------------------------------- |
| Tiel, `auto`, normal cache            | Yes            | Yes            | Adopted; exact output-only format still failed |
| Cyber-Tiel, `agentic`, normal cache   | No             | No             | Existing configuration failed task acceptance  |
| Cyber-Tiel, `auto`, normal cache      | No             | No             | Candidate rejected                             |
| Cyber-Tiel, `agentic`, cache disabled | No             | No             | Diagnostic failed; no cache change adopted     |

All four managed servers reported required/active MTP during admission and stopped successfully. The new profile is qualified only for the bounded Tiel acceptance shown here. Cyber-Tiel remains selectable but its managed read-task reliability is unresolved. The prior direct-server read success does not establish equivalence with managed activation; scheduler width, cache configuration, preceding requests, and prompt context differ between those probes.

Validation after the scoped change: 11,390 deterministic tests passed, 17 skipped; 208 SDK tests and 259 script tests passed (94 script tests skipped). Generated SDK artifacts include the two selected model aliases and are byte-stable on a second build. Recursive typecheck and repository structure checks passed. The native phase audit validates all 24 confirmation receipts and retains both eligible and rejected pilots.
