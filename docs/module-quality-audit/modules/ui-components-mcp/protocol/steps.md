# Review Protocol: ui-components-mcp

Reviewer: codex-sol  
Independent verifier: ax-code-glm  
Date: 2026-08-11

## Step 1 Scope and public surface

The `ui-components-mcp` unit is the single file `desktop/packages/ui/src/components/mcp/McpDropdown.tsx`, matching the scope recorded in `docs/module-quality-audit/modules/ui-components-mcp/MODULE-AUDIT.md:5-18`. It exports the reusable panel body `McpDropdownContent` at `McpDropdown.tsx:70` and the standalone responsive trigger/panel `McpDropdown` at `McpDropdown.tsx:210`. The direct repository consumer is `desktop/packages/ui/src/components/layout/Header.tsx:32,480-482`, which imports and conditionally mounts only `McpDropdownContent`; repository search found no consumer of the full `McpDropdown` export outside its defining file.

## Step 2 Trust and failure boundaries

This component does not read credentials or execute processes. Its meaningful boundary is user-triggered mutation of MCP runtime state: each row calls `connect` or `disconnect` with a server name and current directory at `desktop/packages/ui/src/components/mcp/McpDropdown.tsx:179-195` and again in the standalone rendering path at `McpDropdown.tsx:333-349`. Those methods reach generated SDK operations with `throwOnError` in `desktop/packages/ui/src/stores/useMcpStore.ts:230-257`. Server names and status errors are rendered as React text at `McpDropdown.tsx:149-175`, so React escaping prevents markup injection. The directory label exposes only the final path segment at `McpDropdown.tsx:125-129,416-421`.

## Step 3 State and correctness review

Status presentation covers connected, failed, authentication-required, registration-required, and unknown states at `desktop/packages/ui/src/components/mcp/McpDropdown.tsx:17-59`. Configured names and runtime-status names are unioned and sorted at `McpDropdown.tsx:96-104`, preventing configured-but-disconnected servers from disappearing. A correctness concern remains in both toggle handlers: one `busyName` value (`McpDropdown.tsx:81,244`) represents every in-flight server operation. Starting B while A is pending replaces A's busy marker, and A's `finally` can clear B's marker at `McpDropdown.tsx:183-193,337-347`. Rejections are not caught or surfaced by either handler, even though `useMcpStore.connect` deliberately rethrows at `useMcpStore.ts:234-248` and disconnect can reject at `useMcpStore.ts:252-257`.

## Step 4 Rendering and request cost

The panel body starts a status refresh on mount (`desktop/packages/ui/src/components/mcp/McpDropdown.tsx:83-85`), a forced config load on mount (`McpDropdown.tsx:87-89`), and repeats both whenever `active` is true (`McpDropdown.tsx:91-94`). Because `Header` mounts the content only for the active MCP tab at `desktop/packages/ui/src/components/layout/Header.tsx:480-482`, opening that tab launches two requests of each kind. The standalone component also refreshes at `McpDropdown.tsx:246-256` before mounting an active child at `McpDropdown.tsx:440-442`, multiplying calls further. Request sequencing prevents stale writes (`desktop/packages/ui/src/stores/useMcpStore.ts:126-173`; `useMcpConfigStore.ts:143-176`), but forced loads still perform redundant network work.

## Step 5 Component ownership and duplication

Runtime IO appropriately remains in Zustand stores: the component selects `refresh`, `connect`, and `disconnect` at `desktop/packages/ui/src/components/mcp/McpDropdown.tsx:72-79,219-224`, while SDK access resides in `desktop/packages/ui/src/stores/useMcpStore.ts:31-37,126-174,230-257`. Within the component, however, server-row rendering and toggle behavior are duplicated between `McpDropdownContent` at `McpDropdown.tsx:143-204` and `renderServerList` at `McpDropdown.tsx:283-359`. Since `Header.tsx:32,481` consumes only the content export and repository search found no external full-dropdown consumer, the second responsive shell is likely legacy surface and increases drift risk.

## Step 6 Accessibility and code hygiene

The open and refresh buttons have translated accessible names at `desktop/packages/ui/src/components/mcp/McpDropdown.tsx:131-139,362-369,401-409`. In contrast, each server `Switch` at `McpDropdown.tsx:179-195,333-349` has neither `aria-label` nor `aria-labelledby`, and the adjacent server-name span is not a `<label>`. The shared switch wrapper simply forwards properties to `BaseSwitch.Root` at `desktop/packages/ui/src/components/ui/switch.tsx:6-24`, so it does not synthesize a name. This is a Medium accessibility finding. The status tooltip trigger is also a non-focusable span at `McpDropdown.tsx:158-174,311-327`, limiting keyboard discovery. No empty catch, TODO, FIXME, or suppression was found in the unit source.

## Step 7 Test coverage assessment

The audit inventory lists backend MCP suites at `docs/module-quality-audit/modules/ui-components-mcp/MODULE-AUDIT.md:32-47`, but no direct dropdown component test. Related store tests prove stale status responses cannot overwrite newer data and prove path normalization at `desktop/packages/ui/src/stores/useMcpStore.test.ts:84-110`; they also cover SDK resource reads and resource refresh ordering at `useMcpStore.test.ts:113-143`. Config-store tests cover overlapping forced loads and directory switches at `desktop/packages/ui/src/stores/useMcpConfigStore.test.ts:88-160`. Missing tests are keyboard/screen-reader naming, concurrent toggles across two servers, rejection feedback, mobile versus desktop rendering, and the number of refresh calls on first activation.

## Step 8 Findings and severity

The pre-existing register says `_none accepted_` at `docs/module-quality-audit/modules/ui-components-mcp/MODULE-AUDIT.md:61-65`, and there are no files under this unit's `findings/` directory. This review identifies two Medium concerns: unnamed server switches (`desktop/packages/ui/src/components/mcp/McpDropdown.tsx:179-195,333-349`) and unsafe single-name coordination plus unsurfaced rejection for overlapping mutations (`McpDropdown.tsx:81,183-193,244,337-347`). It also identifies a Low request-efficiency/design concern from duplicated activation fetches and row implementations (`McpDropdown.tsx:83-94,246-359`). None is Critical, so the conditional secondary-confirmation file is not created.

## Step 9 Verification and exit

Focused verification passed on 2026-08-11: `pnpm --filter @openchamber/ui exec vitest run src/stores/useMcpStore.test.ts src/stores/useMcpConfigStore.test.ts` reported 2 files and 6 tests passed; `pnpm --filter @openchamber/ui run type-check` completed with no diagnostics; and `pnpm --filter @openchamber/ui exec eslint src/components/mcp/McpDropdown.tsx --config ../../eslint.config.js` completed cleanly. These checks validate the store contracts and static component shape cited above, but they do not exercise the missing interaction cases identified in Step 7. Review protocol completion is therefore documented with no Critical blocker and with the Medium/Low follow-up risks preserved in this artifact.
