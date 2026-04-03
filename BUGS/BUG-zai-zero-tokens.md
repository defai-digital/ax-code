# BUG: All providers using @ai-sdk/openai-compatible report 0 tokens

**Date:** 2026-04-03
**Severity:** High
**Status:** Fixed

## Symptoms

- Context panel shows "0 tokens, 0% used, $0.00 spent" for all sessions
- Token counter in prompt status bar is empty
- All assistant messages in the database have zero tokens
- Affected all providers using `@ai-sdk/openai-compatible` (Z.AI, Alibaba, DeepSeek, Groq, etc.)

## Root Cause

`@ai-sdk/openai-compatible` v2.x changed the usage format from flat numbers to structured objects:

**Old format (v1.x):**
```json
{ "inputTokens": 12145, "outputTokens": 50 }
```

**New format (v2.x):**
```json
{ "inputTokens": { "total": 12145, "noCache": 12081, "cacheRead": 64 }, "outputTokens": { "total": 50, "text": 50, "reasoning": 0 } }
```

The `safe()` function in `getUsage()` checked `Number.isFinite(value)` — objects return `false`, so all token counts were set to 0.

## Evidence

Debug logging confirmed Z.AI returns:
```
inputTokens={"total":12145,"noCache":12081,"cacheRead":64}
outputTokens={"total":4,"text":4,"reasoning":0}
```

## Fix

Updated `safe()` to handle both formats:
```typescript
const safe = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value && typeof value === "object" && "total" in value) return safe((value as any).total)
  return 0
}
```

## Files Changed

- `packages/ax-code/src/session/index.ts:782-785` — `safe()` function in `getUsage()`
