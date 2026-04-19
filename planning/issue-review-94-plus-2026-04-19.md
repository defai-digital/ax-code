# GitHub Issue Sweep: `#94+` on `v2.26.3`

Date: 2026-04-19
Status: Active follow-up log

## Scope

Reviewed all GitHub issues with number greater than `93` against the current local `main` branch (`v2.26.3`) to identify:

- fixes that are still present
- fixes that were claimed closed but were not actually retained on this branch
- items that are native-preview only and should not block the default OpenTUI path

## Fixed In This Sweep

These issues were still reproducible or clearly still present in source, and were fixed in the current local changes:

- `#98` workspace SSE reconnection loop leaked abort listeners when the timeout won
- `#100` SSE backpressure only dropped delta events; heartbeat and other events still bypassed the soft cap
- `#115` bash permission path checks were still using synchronous `statSync` via `Filesystem.isDir()`
- `#120` `Filesystem.exists()` still used `existsSync` in an async API

## Confirmed Already Retained On Current Branch

These issues were checked by current source and/or existing tests and do not need another patch in this sweep:

- Release / packaging: `#95`, `#97`, `#105`, `#130`
- API / route correctness: `#99`, `#101`, `#102`, `#103`, `#111`, `#117`, `#127`, `#148`
- Filesystem / path hardening: `#104`, `#110`, `#121`, `#135`, `#159`, `#162`
- Session / agent correctness: `#118`, `#147`, `#149`, `#153`, `#157`
- Security / hardening batch: `#122`, `#123`, `#126`, `#141`, `#142`, `#143`, `#144`, `#145`, `#151`, `#154`, `#155`, `#156`, `#160`, `#161`, `#163`, `#164`

## Reviewed But Not Patched In This Sweep

These were reviewed as part of the `#94+` pass but were intentionally left out of this patch because they are either broader design work, lower-priority tech debt, or need a dedicated pass:

- Tech debt / architecture: `#106`, `#107`, `#108`, `#140`
- Performance / cleanup follow-ups worth a later pass: `#109`, `#112`, `#113`, `#114`, `#116`, `#119`, `#124`, `#125`, `#129`, `#131`, `#132`, `#133`, `#134`, `#136`, `#137`, `#138`, `#139`, `#152`, `#158`

## Native Preview Only

These are relevant to the native renderer path, but `OpenTUI` remains the default renderer and these should be handled in the native stabilization track:

- `#166` native TUI floods terminal with raw text on startup
- `#167` typing/input freezes after fullscreen or resize transition

## Patch Notes

This sweep adds two small reusable helpers:

- `src/server/sse-queue.ts`
  used by both server SSE routes so backpressure policy is shared instead of duplicated
- `src/control-plane/abort.ts`
  used by workspace reconnection backoff so abort listeners are cleaned up correctly

## Verification

Passed locally:

- `bun test ./test/server/sse-queue.test.ts ./test/util/filesystem.test.ts ./test/control-plane/abort.test.ts ./test/control-plane/workspace-sync.test.ts`
- `pnpm run typecheck`
