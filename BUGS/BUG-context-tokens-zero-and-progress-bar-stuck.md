# BUG: Context tokens show 0/0% and progress bar does not move

**Date:** 2026-04-03
**Severity:** High
**Status:** Fixed (v1.6.8-v1.6.12)

## Symptoms

- Context panel shows "0 tokens, 0% used" during active LLM streaming
- Progress bar stays empty
- User perceives the system as hung

## Root Causes and Fixes

### 1. Token usage returned as objects, not numbers — FIXED (v1.6.8)
`@ai-sdk/openai-compatible` v2.x returns `inputTokens: { total: 12145, noCache: 12081 }` instead of `inputTokens: 12145`. The `safe()` function in `getUsage()` treated objects as non-finite and returned 0. Fixed by extracting `.total` from structured objects.

### 2. Token display filter too strict — FIXED (v1.6.8)
Sidebar and header filtered for `x.tokens.output > 0`, excluding messages where only input tokens were reported. Changed to `x.tokens.output > 0 || x.tokens.input > 0`.

### 3. finishReason coercion broke tool-call continuation — FIXED (v1.6.11)
The `finishReason` coercion converted `{ type: "tool-calls" }` → `"stop"`, causing the agent to exit after one tool call instead of continuing. Fixed by extracting `.type` from object finish reasons. Also added `usedTools` flag as a fallback.

### 4. Progress bar added with animation — FIXED (v1.6.10)
Added animated progress bar to sidebar showing context fill level with a bouncing indicator when busy.

### 5. Inline token counter added — FIXED (v1.6.8)
Token count and percentage now shown in the prompt status bar.

### 6. Unbounded retry loop — NOT A BUG
The retry loop already has `RETRY_MAX_ATTEMPTS = 5` cap. The bug report was incorrect about this.

## Remaining Known Limitation

Tokens show 0 during streaming until `finish-step` fires. This is by design — accurate token counts require the LLM to report usage, which only happens at step completion. The progress bar animates to indicate work is happening.
