# Protocol Steps: provider-cli

- Slug: `provider-cli`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Scope and boundaries

The unit translates AI SDK prompts into commands for seven external assistants, parses their output, resolves their configured models, and probes their availability. Provider-specific executable, argument, parser, prompt-mode, and workspace behavior is centralized in `packages/ax-code/src/provider/cli/config.ts:12-75`; process orchestration is concentrated in `packages/ax-code/src/provider/cli/cli-language-model.ts:197-365` and `packages/ax-code/src/provider/cli/cli-language-model.ts:367-658`. Attachment materialization and model discovery are separate boundaries at `packages/ax-code/src/provider/cli/attachments.ts:86-130` and `packages/ax-code/src/provider/cli/resolve.ts:84-190`.

## Step 2 Process and data threats

User prompt text, attachment bytes, inherited environment variables, workspace paths, and provider output all cross a child-process boundary. The command is passed as an argument vector rather than shell text at `packages/ax-code/src/provider/cli/cli-language-model.ts:154-170`, while `cliEnv` starts from a sanitized environment and only restores the selected provider's approved credential at `packages/ax-code/src/provider/cli/cli-language-model.ts:69-84` and `packages/ax-code/src/util/env.ts:40-82`. Autonomous mode deliberately adds provider permission-bypass flags at `packages/ax-code/src/provider/cli/cli-language-model.ts:145-151`, so callers must treat that flag as authorization for the external CLI to act in the active workspace.

## Step 3 Lifecycle correctness

Generation checks pre-abort, materializes files, spawns with explicit stdio, attaches process-abort handling, schedules attachment cleanup for either exit outcome, and rejects nonzero or empty-output results at `packages/ax-code/src/provider/cli/cli-language-model.ts:259-365`. Streaming separately waits for stdout, stderr, and the exit code before success or failure, removes listeners on closure, resets its inactivity ceiling on either output channel, and kills the process on cancellation at `packages/ax-code/src/provider/cli/cli-language-model.ts:405-465` and `packages/ax-code/src/provider/cli/cli-language-model.ts:554-653`. The Critical stdin path installs `error` and `close` listeners before `write`, rejects a blocked drain, and retains the error handler through late `EPIPE` delivery at `packages/ax-code/src/provider/cli/cli-language-model.ts:87-143`.

## Step 4 Parsing and resource behavior

Non-JSON lines avoid `JSON.parse` through the first-character fast path at `packages/ax-code/src/provider/cli/json.ts:9-24`, and streaming uses `StringDecoder` so UTF-8 code points split across chunks survive intact at `packages/ax-code/src/provider/cli/cli-language-model.ts:474-548`. The five-minute generation ceiling kills the process and bounds the post-kill drain wait to one second at `packages/ax-code/src/provider/cli/cli-language-model.ts:294-350`; streaming instead treats the same value as an inactivity timeout at `packages/ax-code/src/provider/cli/cli-language-model.ts:448-466`. Complete generation still buffers both output streams in memory at `packages/ax-code/src/provider/cli/cli-language-model.ts:300-315`, which is acceptable for normal assistant replies but remains the principal resource risk for a misbehaving CLI with unbounded output.

## Step 5 Responsibility and coupling

The separation is coherent: `config.ts` declares provider mechanics, `parser.ts` owns wire-shape decoding, `prompt.ts` flattens AI SDK messages, `attachments.ts` owns temporary files, and `resolve.ts` owns user configuration precedence. The outer registry checks binary/auth availability and constructs this adapter without duplicating its streaming logic at `packages/ax-code/src/provider/loaders.ts:403-445`. One maintainability edge is the repeated provider-ID tables across `packages/ax-code/src/provider/cli/config.ts:21-72`, `packages/ax-code/src/provider/cli/effort.ts:1-29`, and `packages/ax-code/src/provider/cli/resolve.ts:12-20`; additions require coordinated edits, but the current seven definitions are aligned.

## Step 6 Error hygiene and stale surfaces

Malformed JSON and invalid data URLs are intentionally classified as absent input at `packages/ax-code/src/provider/cli/json.ts:12-24` and `packages/ax-code/src/provider/cli/attachments.ts:52-63`; an unavailable project instance likewise falls back to no working directory at `packages/ax-code/src/provider/cli/cli-language-model.ts:189-195`. The only swallowed promise failures in this unit are best-effort temporary-directory removals at `packages/ax-code/src/provider/cli/attachments.ts:117-128`; process, parse, timeout, and output failures are otherwise logged or surfaced. No TODO/FIXME marker was present. The exported `decodeCliJsonObject` remains exercised at `packages/ax-code/test/provider/cli/json.test.ts:4-20`, so it is not an orphaned helper.

## Step 7 Regression coverage

The focused suite exercises attachment decoding/cleanup at `packages/ax-code/test/provider/cli/attachments.test.ts:6-86`, parser error and noise handling at `packages/ax-code/test/provider/cli/parser.test.ts:14-146`, prompt serialization at `packages/ax-code/test/provider/cli/prompt.test.ts:5-213`, auth probes at `packages/ax-code/test/provider/cli/connect.test.ts:5-150`, and environment/config precedence at `packages/ax-code/test/provider/cli/resolve.test.ts:7-390`. Process tests cover generate/stream contracts, aborts, timeouts, UTF-8 splits, provider arguments, and the exact stdin regression at `packages/ax-code/test/provider/cli/cli-language-model.test.ts:53-176`, `packages/ax-code/test/provider/cli/cli-language-model.test.ts:477-510`, and `packages/ax-code/test/provider/cli/cli-language-model.test.ts:629-823`. A direct streaming-mode `EPIPE` case would strengthen the shared writer coverage, although both paths call the same `writeCliPrompt` implementation.

## Step 8 Finding disposition

`docs/module-quality-audit/modules/provider-cli/findings/AUDIT-provider-cli-001.md:1-30` records one Critical stability issue as verified-fixed. A fresh source pass confirmed that `stdin.on("error", onError)` and `stdin.once("close", onClose)` precede `stdin.write(text)`, with close removing the persistent error listener at `packages/ax-code/src/provider/cli/cli-language-model.ts:100-140`; the regression forces backpressure, emits `EPIPE`, and checks both error and drain listener removal at `packages/ax-code/test/provider/cli/cli-language-model.test.ts:477-510`. No additional finding was accepted: the remaining observations are bounded cleanup/test-maintenance risks rather than a demonstrated invariant violation.

## Step 9 Executed verification

The command `AX_TEST_FILES=test/provider/cli/attachments.test.ts,test/provider/cli/cli-language-model.test.ts,test/provider/cli/connect.test.ts,test/provider/cli/json.test.ts,test/provider/cli/parser.test.ts,test/provider/cli/prompt.test.ts,test/provider/cli/resolve.test.ts pnpm --dir packages/ax-code exec vitest run --reporter=dot` passed 116 tests in seven files. I also ran the single `EPIPE` case named at `packages/ax-code/test/provider/cli/cli-language-model.test.ts:477-510` independently; it passed with 44 unrelated tests skipped. `pnpm --dir packages/ax-code run typecheck` completed successfully, covering the `LanguageModelV3` implementation declared at `packages/ax-code/src/provider/cli/cli-language-model.ts:197-215`.
