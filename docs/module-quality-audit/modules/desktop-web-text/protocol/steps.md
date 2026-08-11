# Protocol review — desktop-web-text

## Step 1 Scope and public surface

The `desktop-web-text` unit is implemented by `desktop/packages/web/server/lib/text/summarization.js`. It exports three mode-specific sanitizers at lines 10, 28, and 46 and the compatibility summarization entrypoint at line 119. The adjacent `summarization.test.js:1-38` contains the unit tests, while `DOCUMENTATION.md:13-18` names the same four exports. A repository search found the production integration at `desktop/packages/web/server/lib/notifications/template-runtime.js:1,66-75`; no barrel file broadens this module's public surface.

## Step 2 Threat and failure model

The module accepts display text, so its relevant risks are unintended content retention, malformed fallback output, and excessive work on large inputs. Summary sanitization removes fenced and inline code at `summarization.js:14-15`, shell-like punctuation at lines 18-21, URLs at line 22, and path-shaped strings at line 23. Notification and note modes preserve human-readable inline-code content (`summarization.js:33,51`) rather than treating these helpers as a security boundary. There are no imports or I/O calls in `summarization.js:1-138`, and the retired provider argument is explicitly discarded at line 120, so text cannot leave the process through this unit.

## Step 3 Correctness and edge cases

Mode selection is deterministic: note and notification are selected at `summarization.js:65-68`, and every other mode falls back to summary semantics. Empty or non-string sanitizer inputs return an empty string at lines 11, 29, and 47. For short text, `summarizeText` returns the local fallback plus a threshold/no-text reason at lines 122-129; longer text returns the same local fallback and length metadata at lines 131-137. Two contract ambiguities are non-blocking but deserve future tests or documentation: summary mode ignores `maxLength` through `fallbackByMode` at lines 113-117, while notification mode imposes a minimum limit of 20 at line 106 even when a smaller `maxLength` is requested.

## Step 4 Performance and resource use

All operations are local string transformations. The sanitizer pipelines are fixed sequences of replacements (`summarization.js:13-25,31-43,49-62`), and the two distillers build a sentence array once at lines 80-83 and 101-104. This is linear work with transient strings/arrays proportional to input size; there are no timers, handles, caches, network requests, or persistent resources. Note clipping is bounded by the computed `idealLimit` at lines 89-94, and notification clipping occurs at lines 106-110. Summary mode can return the complete sanitized input, so callers that pass very large summary-mode text receive no length cap.

## Step 5 Design and ownership

The module remains surface-neutral as required by `desktop/packages/web/server/lib/text/DOCUMENTATION.md:38-42`: mode routing and shared fallback behavior stay in the text folder. The notification layer adapts the object-returning API to its string contract at `template-runtime.js:66-75`, explicitly supplying `threshold: 0` and `mode: "notification"`. Keeping provider retirement inside the shared entrypoint (`summarization.js:119-120`) preserves call compatibility without coupling the helper to notification settings. Private helpers at lines 65-117 contain mode dispatch and distillation, leaving only the four documented functions exported.

## Step 6 Hygiene and maintainability

There are no catch blocks, TODO markers, or dependency imports in `summarization.js:1-138`. The apparently unused `zenModel` parameter is intentionally consumed with `void zenModel` at line 120, matching the compatibility statement in `DOCUMENTATION.md:15`. Prefix cleanup for notes is narrowly expressed at lines 75-78, and clipping appends a single ellipsis at lines 93-94 and 109-110. The async entrypoint has no await, but retaining its Promise shape is consistent with the existing caller's awaited use at `template-runtime.js:68-74`; removing async would be an API change rather than a safe cleanup.

## Step 7 Test coverage

`summarization.test.js:6-9` checks both inline and fenced code removal in summary mode. Lines 11-23 assert that a supplied Zen model is not called and that notification fallback clips to the expected ellipsis, while lines 25-38 assert first-sentence note distillation. The focused run used the web package test script declared at `desktop/packages/web/package.json:26` and passed 3/3 tests. Missing direct cases include exported `sanitizeForNotification` and `sanitizeForNote`, empty/non-string inputs, the below-threshold result shape, unknown-mode fallback, summary-mode length behavior, and notification limits below 20.

## Step 8 Findings register

The existing register in `docs/module-quality-audit/modules/desktop-web-text/MODULE-AUDIT.md:64-68` contains no accepted finding, and there are no files under this unit's `findings/` directory. This review found no Critical, High, or Medium defect requiring a new finding artifact. The two length semantics noted in Steps 3 and 7 are low-risk API/documentation gaps because the only production caller supplies notification mode (`template-runtime.js:68-74`) and already falls back to the original text if the returned summary is empty at line 75.

## Step 9 Verification and sign-off

The focused command `pnpm --dir desktop/packages/web exec vitest run server/lib/text/summarization.test.js` completed with one test file and all three tests passing; the file is included by the desktop web project glob at `desktop/vitest.config.ts:39-45`. The implementation, test, text-module documentation, notification integration, package script, audit register, and Vitest configuration were read for this pass. Because `MODULE-AUDIT.md:66-68` records no finding and the independent review above raised no Critical item, no `reverify.md` is needed. Reviewer `codex-sol`; designated verifier `ax-code-glm`; review date 2026-08-11.
