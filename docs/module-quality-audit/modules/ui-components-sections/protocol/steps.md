# Protocol Steps — ui-components-sections

Unit slug: `ui-components-sections`
Reviewer lane: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Verifier lane: codex-sol
Resolved root: `desktop/packages/ui/src/components/sections`

## Step 1 Scope and map

Twenty source files were read directly under
`desktop/packages/ui/src/components/sections/{agents,ax-code}/`. The two largest
bodies are `ax-code/AXCodeVisualSettings.tsx` (1751 lines) and
`agents/AgentsPage.tsx` (1219 lines); both are single-component files. The unit
also contains two co-located test files (`agents/permissionToolIds.test.ts`,
`ax-code/axCodeCliSettingsSave.test.ts`) and a set of small extracted
save/load helpers referenced by the MODULE-AUDIT inventory
(`axCodeCliSettingsSave.ts`, `defaultsSettingsLoad.ts`, `gitSettingsLoad.ts`,
`githubDeviceFlowPoll.ts`, `passkeySettingsLoad.ts`) — these helpers sit next to
their consumers and keep fetch/poll logic out of the JSX, which is a healthy
separation for this unit. `agents/permissionToolIds.ts` (20 LOC) plus its test
isolate a single pure function and are the cleanest pair here.

## Step 2 Threat and failure model

These are React settings components rendered inside the desktop web runtime
(Electron). They issue `fetch` calls against local `API_ENDPOINTS`
(`AxCodeCliSettings.tsx:28`, `DefaultsSettings.tsx:102`,
`DesktopNetworkSettings.tsx:41,171`, `GitHubSettings.tsx:73,110,189,215`) and
invoke runtime bridges (Tauri dialog in `AxCodeCliSettings.tsx:63-75`,
`runtimeGitHub` in `GitHubSettings.tsx:70-89,106-128,186-196,212-228`). No
`eval`, no `innerHTML`, no shell/command concatenation. The one credential
surface is `DesktopNetworkSettings.tsx:177-181`, which PUTs `desktopUiPassword`
as cleartext JSON to the local config endpoint; acceptable for localhost but the
value round-trips through component state in the clear, so any renderer-level
leak would expose it. `PasskeySettings.tsx` defers all WebAuthn ceremony work to
`@/lib/passkeys` and only renders status — no secret material in this file.

## Step 3 Correctness

- `AgentsSidebar.handleRenameAgent`
  (`desktop/packages/ui/src/components/sections/agents/AgentsSidebar.tsx:198-251`)
  implements rename as create-new (`createAgent`, line 224) then delete-old
  (`deleteAgent`, line 239) with no rollback. If create succeeds and delete
  fails, the user is left with BOTH agents and only a toast
  (`removeOldAfterRenameFailed`, line 244). This is a real state-divergence
  defect, not a cosmetic issue.
- `DefaultsSettings.handleModelChange`
  (`DefaultsSettings.tsx:83-115`) persists `defaultModel` twice: once via
  `updateDesktopSettings` (line 101) and again via a separate `fetch PUT`
  (lines 102-109). The two writes are uncoordinated; if the second fails the
  persisted stores can disagree and the only signal is `console.warn` (line 108).
- `WorktreeSectionContent.handleDeleteWorktree` recursion
  (`WorktreeSectionContent.tsx:222-233`) walks child sessions via `parentID`
  with no visited-set guard. A cyclic `parentID` chain would spin; unlikely in
  practice but unguarded.
- `AgentsPage.permissionConfigToRuleset` skips `"__originalKeys"`
  (`AgentsPage.tsx:109`) when rebuilding rules, but there is no test exercising
  that branch — it is silently unverified.

## Step 4 Performance

- `AXCodeVisualSettings.tsx` subscribes to ~50 individual `useUIStore` selector
  hooks in one component (lines 227-295). Any single UI-store mutation re-renders
  the entire 1751-line tree. Splitting per-section children (appearance / layout /
  chat / checkboxes) would localize re-renders.
- `AgentsPage.knownPermissionNames` (`AgentsPage.tsx:239-265`) rebuilds a Set
  from every agent's ruleset and every session permission request on each dep
  change — O(agents × sessions). Fine at current scale; worth noting if agent
  counts grow.
- The chat-render-preview `requestAnimationFrame` loop
  (`AXCodeVisualSettings.tsx:302-343`) runs continuously while the chat settings
  panel is open. It is correctly gated by `shouldAnimateChatPreview`, observes
  `document.visibilityState`, and cancels on unmount — no leak.
- `WorktreeSectionContent.sessionsKey` (line 256) joins all session ids into a
  string each render to feed an effect dep array; acceptable for moderate
  session counts.

## Step 5 Design

- `AXCodePage.tsx` (lines 20-46) cleanly maps an `AXCodeSection` discriminator
  to content components — a tidy section router and a good structural anchor.
- `permissionToolIds.ts` + `permissionToolIds.test.ts` isolate a tiny pure
  helper with direct unit tests — exemplary boundary for this unit and worth
  imitating elsewhere.
- `AXCodeVisualSettings.tsx` is a single 1751-line component owning theme,
  fonts, spacing, navigation, chat render mode, diff layout, message transport,
  and roughly ten boolean-toggle rows. The checkbox-with-role-button block
  (lines 1450-1744) is duplicated ~10 times with only label/checked/onChange
  varying — a clear candidate for a shared `<CheckboxRow>` helper (well past the
  3-call-site threshold).
- `NotificationSettings.tsx` repeats the same role-button checkbox block
  (lines 169-428) ~6 times; the same helper would apply.

## Step 6 Dead code and hygiene

- `AxCodeCliSettings.tsx` swallows config-load errors silently
  (`catch { // ignore }`, line 41): on endpoint failure the user sees a blank
  binary path with no error indication. Not dead code, but a silent-failure
  site worth surfacing.
- `AxCodeCliSettings.handleBrowse` also swallows Tauri dialog errors
  (line 79, `catch { // ignore }`).
- `WorktreeSectionContent.tsx` carries four `catch { // Ignore errors }` blocks
  (lines 59, 76, 109, 136) across refresh/load paths — all invisible to the
  user.
- `AgentsPage.formatPermissionLabel` (`AgentsPage.tsx:416-434`) hardcodes
  display overrides (`webfetch`→"WebFetch", `doom_loop`→"Doom Loop", etc.)
  bypassing i18n for those labels.
- No `TODO`/`FIXME` markers. No strictly-empty catch blocks (every catch has a
  comment), consistent with the MODULE-AUDIT hygiene row of 0 empty catches.

## Step 7 Tests

- `agents/permissionToolIds.test.ts` (19 lines, 3 cases) covers trim/dedupe/sort,
  placeholder/grouped-id removal, and non-string filtering — good coverage of a
  pure helper.
- `ax-code/axCodeCliSettingsSave.test.ts` (40 lines, 2 cases) covers
  trim-before-save and reload-failure-returned-as-result. Both co-located tests
  are well-scoped and readable.
- Uncovered higher-risk paths: the `AgentsPage` permission round-trip
  (`permissionConfigToRuleset` ↔ `buildPermissionConfigWithGlobal`,
  `AgentsPage.tsx:98-157`), the `AgentsSidebar` rename partial-failure path
  (line 237-248), and the `DefaultsSettings` double-write
  (`DefaultsSettings.tsx:100-112`). These are the branches most likely to
  regress silently.

## Step 8 Finding register

- **MEDIUM** — `AgentsSidebar` rename is non-atomic (create-then-delete) with no
  rollback on partial failure (`AgentsSidebar.tsx:224-244`). Leaves duplicate
  agents when the second leg fails.
- **LOW** — `DefaultsSettings.handleModelChange` writes `defaultModel` through
  two uncoordinated persistence paths (`DefaultsSettings.tsx:101-109`);
  divergence surfaces only as `console.warn`.
- **LOW** — Silent catches in `AxCodeCliSettings.tsx` (lines 41, 79) and
  `WorktreeSectionContent.tsx` (lines 59, 76, 109, 136) hide load/browse errors
  from the user.
- **INFO** — `AXCodeVisualSettings.tsx` and `NotificationSettings.tsx` duplicate
  the Checkbox role-button row pattern 10+/6+ times; extracting a shared
  `CheckboxRow` would improve maintainability.

No Critical findings, no High findings. Scope `ui-components-sections`.

## Step 9 Verification and exit

No Critical findings were identified, so no `protocol/reverify.md` second-pass
artifact is required for this unit. This review is docs-only over read-only UI
source; no source files were mutated, so the project typecheck/test gates are
unaffected and no `verify_project` run is needed to validate the review itself.
Files examined: 20 sources under
`desktop/packages/ui/src/components/sections/{agents,ax-code}/` plus
`MODULE-AUDIT.md`. Dual-agent protocol steps 1–9 complete for the ax-code-glm
lane; the codex-sol lane may independently confirm before sign-off.
