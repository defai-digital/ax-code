# Protocol steps — provider-retry-errors

Reviewer: codex-sol (model `gpt-5.6-sol-xhigh`)
Verifier lane: ax-code-glm
Slug: `provider-retry-errors`

## Step 1 Scope and public surface

The reviewed unit consists of `packages/ax-code/src/provider/cli/effort.ts`, `packages/ax-code/src/provider/effort-label.ts`, and `packages/ax-code/src/provider/error.ts`. The CLI file exports four helpers at lines 7–29; the presentation file defines `EffortOption` at lines 9–18 and six runtime helpers at lines 77–155; the error namespace exposes JSON decoding, stream classification, and API-call classification at `packages/ax-code/src/provider/error.ts:77-264`. Related reads established the boundaries: CLI variants enter provider transformation at `packages/ax-code/src/provider/transform.ts:355-360`, effort arguments enter subprocess construction at `packages/ax-code/src/provider/cli/cli-language-model.ts:154-170`, and parsed provider failures enter session errors at `packages/ax-code/src/session/message-v2-impl.ts:1142-1167`.

## Step 2 Trust boundaries and failure modes

Effort values can originate in provider options, but `cliEffortFromProviderOptions` rejects arrays, non-records, non-strings, and values outside the provider allowlist (`packages/ax-code/src/provider/cli/effort.ts:15-21`); `cliEffortArgs` repeats the allowlist check before producing process arguments at lines 24–29. Provider response bodies and URLs are untrusted. JSON extraction accepts records only (`packages/ax-code/src/util/json-record.ts:4-16`), HTML gateway pages are replaced with actionable text rather than echoed (`packages/ax-code/src/provider/error.ts:61-70`), and Alibaba host recognition parses the hostname and requires `aliyuncs.com` or a true subdomain at lines 136–148. The remaining diagnostic path can retain a raw non-HTML response body at line 73, so downstream storage and display must continue treating error text as untrusted provider content.

## Step 3 CLI effort correctness

One table defines the supported levels for Claude Code, Codex CLI, and Grok Build CLI (`packages/ax-code/src/provider/cli/effort.ts:1-5`). Unknown providers return an empty list at lines 7–9, which also makes their variants and arguments empty. Valid nested provider options are read using the exact provider ID at lines 15–21. Native encodings are provider-specific and passed as array elements: Claude uses `--effort`, Codex uses `-c` plus `model_reasoning_effort=...`, and Grok uses `--reasoning-effort` at lines 24–29. `buildCliCommand` appends these validated elements before workspace/model/prompt arguments (`packages/ax-code/src/provider/cli/cli-language-model.ts:160-170`), avoiding shell-string interpolation. Tests confirm all three encodings and rejection of `$(unsafe)` at `packages/ax-code/test/provider/cli/cli-language-model.test.ts:1110-1176`.

## Step 4 Effort presentation and option correctness

Friendly copy is centralized in `KNOWN` (`packages/ax-code/src/provider/effort-label.ts:20-69`). Undefined and empty values consistently mean Auto at lines 77–78, 85–88, and 104–107. Known lookup is case-insensitive while an unknown key is preserved apart from capitalizing its first character at lines 71–81. `effortOptions` always prepends the clear-to-Auto choice, skips empty and duplicate wire keys, and retains the original provider key as `detail` when the friendly label differs (`packages/ax-code/src/provider/effort-label.ts:120-143`). `clampEffort` drops a stored variant when the active model no longer exposes it at lines 149–155. The dialog consumes the returned value without inventing another state axis (`packages/ax-code/src/cli/cmd/tui/component/dialog-effort.tsx:13-30`). No contradictory selection path was found.

## Step 5 Error classification and retry propagation

API-call messages prefer a meaningful SDK message, decode common JSON error shapes, and avoid dumping HTML (`packages/ax-code/src/provider/error.ts:42-74,81-91`). Overflow detection covers provider phrases plus 400/413 no-body forms at lines 13–40; `parseAPICallError` also treats HTTP 413 and structured `context_length_exceeded` as context overflow at lines 222–231. Alibaba short-window quota errors are deliberately retryable and receive stable `errorCode` metadata at lines 236–250. Otherwise the SDK retry bit is preserved, with the documented OpenAI 404 override at lines 253–264. `MessageV2.APIError` requires a boolean `isRetryable` (`packages/ax-code/src/session/message-v2-impl.ts:48-58`), the parser copies it at lines 1157–1167, and the prompt loop stops explicitly non-retryable failures at `packages/ax-code/src/session/prompt-loop-errors.ts:66-75,184-197`. This end-to-end path preserves the classifier’s decision.

## Step 6 Performance and resource behavior

The two effort modules operate on short provider-level arrays: lookup is constant-sized and picker construction is linear in advertised variants (`packages/ax-code/src/provider/effort-label.ts:120-143`). Error matching scans a fixed regex list at `packages/ax-code/src/provider/error.ts:13-35`. Stream serialization is linear in the supplied record and uses a `WeakSet` to terminate circular references, converts bigint safely, and catches serialization failures at lines 94–115. `parseStreamError` performs that serialization before checking `body.type` at lines 167–173, which is a small avoidable cost for non-error records, but there is no I/O, retry loop, timer, or unbounded internal queue in the reviewed files. No performance-severity finding is justified.

## Step 7 Design, maintainability, and hygiene

Responsibilities are separated coherently: CLI wire arguments live in `cli/effort.ts`, user-facing labels in `effort-label.ts`, and provider failure normalization in `error.ts`. The CLI variant producer reuses `cliEffortVariants` rather than duplicating supported-level knowledge (`packages/ax-code/src/provider/transform.ts:355-360`). Error parsing delegates generic record decoding to `packages/ax-code/src/util/json-record.ts:8-16`, while provider-specific quota policy remains local at `packages/ax-code/src/provider/error.ts:117-152`. The three candidate files contain no TODO, FIXME, HACK, or empty catch. Both catches in `error.ts` have defined fallbacks: malformed URLs warn and return an empty hostname at lines 136–143, while failed serialization emits a safe JSON error envelope at lines 107–114.

## Step 8 Test evidence and residual coverage

Focused tests cover JSON record rejection, three common response-message shapes, exact Alibaba-host matching, circular data, bigint, and hostile serialization (`packages/ax-code/test/provider/error.test.ts:6-131`). Presentation tests cover Auto, known and unknown labels, change messages, deduplication, detail text, descriptions, and clamping (`packages/ax-code/test/provider/effort-label.test.ts:11-55`). CLI integration tests cover native arguments, unsupported effort rejection, and forwarding provider options into the spawned command (`packages/ax-code/test/provider/cli/cli-language-model.test.ts:1110-1197`); transform tests cover advertised levels and unsupported CLI providers (`packages/ax-code/test/provider/transform.test.ts:1625-1654`). Branches such as HTML 401/403 copy, OpenAI 404 retry override, and every overflow phrase are not individually asserted, but the reviewed control flow is direct and no defect was established from those gaps.

## Step 9 Findings and verification

`docs/module-quality-audit/modules/provider-retry-errors/findings/` contained no finding files, and this review found no Critical, High, Medium, or Low defect requiring a new ledger entry. In particular, exact hostname validation blocks suffix-spoofing, invalid effort cannot become a CLI flag, and retryability reaches the prompt-loop stop decision. No `reverify.md` is required because there is no Critical item. Verification ran `AX_TEST_FILES=test/provider/error.test.ts,test/provider/effort-label.test.ts,test/provider/cli/cli-language-model.test.ts,test/provider/transform.test.ts pnpm exec vitest run` from `packages/ax-code`; all 4 files and all 195 tests passed. Primary review for `provider-retry-errors` is complete and ready for ax-code-glm verification.
