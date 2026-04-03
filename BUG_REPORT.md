# Bug Report

All previously reported bugs have been resolved.

## Resolved

### BUG: Failing test for TUI thread directory resolution with symlinked PWD

**Date:** 2026-04-03 | **Resolved:** 2026-04-03

**Resolution:** Test now passes (2/2, 6 assertions). The mocking issue was resolved in a prior fix.

**Files:** `test/cli/tui/thread.test.ts`, `src/cli/cmd/tui/thread.ts`

### BUG: Missing import for ibmPlexMonoRegular in Font component

**Date:** 2026-04-03 | **Resolved:** 2026-04-03 (v1.6.13)

**Resolution:** Import added in commit 44ed322.

**Files:** `packages/ui/src/components/font.tsx`

### BUG: Missing type definitions for sanitize-html

**Date:** 2026-04-03 | **Resolved:** 2026-04-03 (v1.6.13)

**Resolution:** `@types/sanitize-html` added as dev dependency in commit 44ed322.

**Files:** `packages/ui/package.json`
