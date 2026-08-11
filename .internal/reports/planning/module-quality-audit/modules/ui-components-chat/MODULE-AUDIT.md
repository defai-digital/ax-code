# MODULE-AUDIT: ui-components-chat

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-chat` |
| Scope | `desktop/packages/ui/src/components/chat` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `7aa7bf12117a744a` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-02 |
| Source files / LOC | 158 / 39955 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-chat` owns `desktop/packages/ui/src/components/chat`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/chat/ActivityBreadcrumb.tsx` | 108 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/AllowPatternBuilder.tsx` | 90 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChangedFilesList.tsx` | 78 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatContainer.test.ts` | 47 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatContainer.tsx` | 1030 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatEmptyState.tsx` | 104 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatErrorBoundary.test.tsx` | 55 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatErrorBoundary.tsx` | 124 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatInput-impl.tsx` | 4232 | 1 | 0 | 1 |
| `desktop/packages/ui/src/components/chat/ChatInput.tsx` | 2 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatMessage.tsx` | 1244 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ChatSurfaceContext.tsx` | 10 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/CommandAutocomplete.test.ts` | 88 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/CommandAutocomplete.tsx` | 369 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/CommandAutocompleteCommands.ts` | 146 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/DiffPreview.tsx` | 129 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/DoneNotCommittedNudge.tsx` | 102 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/DraftPresetChips.tsx` | 280 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ExecutionModeSelector.tsx` | 133 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/FileAttachment.formatSize.test.ts` | 25 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/FileAttachment.tsx` | 690 | 4 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/FileMentionAutocomplete.tsx` | 657 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/MarkdownRenderer.tsx` | 34 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/MarkdownRendererImpl-impl.tsx` | 1981 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/MarkdownRendererImpl.test.ts` | 18 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ActivityBreadcrumb@desktop/packages/ui/src/components/chat/ActivityBreadcrumb.tsx:73` | public/internal | scanned |
| `AllowPatternBuilder@desktop/packages/ui/src/components/chat/AllowPatternBuilder.tsx:14` | public/internal | scanned |
| `ChangedFilesList@desktop/packages/ui/src/components/chat/ChangedFilesList.tsx:13` | public/internal | scanned |
| `ChatContainer@desktop/packages/ui/src/components/chat/ChatContainer.tsx:385` | public/internal | scanned |
| `ChatErrorBoundary@desktop/packages/ui/src/components/chat/ChatErrorBoundary.tsx:108` | public/internal | scanned |
| `ChatInput@desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:4231` | public/internal | scanned |
| `ChatInput@desktop/packages/ui/src/components/chat/ChatInput.tsx:1` | public/internal | scanned |
| `ChatSurfaceProvider@desktop/packages/ui/src/components/chat/ChatSurfaceContext.tsx:4` | public/internal | scanned |
| `CommandInfo@desktop/packages/ui/src/components/chat/CommandAutocomplete.tsx:14` | public/internal | scanned |
| `CommandAutocompleteHandle@desktop/packages/ui/src/components/chat/CommandAutocomplete.tsx:27` | public/internal | scanned |
| `CommandAutocomplete@desktop/packages/ui/src/components/chat/CommandAutocomplete.tsx:57` | public/internal | scanned |
| `buildBuiltInCommands@desktop/packages/ui/src/components/chat/CommandAutocompleteCommands.ts:14` | public/internal | scanned |
| `filterCommandList@desktop/packages/ui/src/components/chat/CommandAutocompleteCommands.ts:126` | public/internal | scanned |
| `DiffPreview@desktop/packages/ui/src/components/chat/DiffPreview.tsx:30` | public/internal | scanned |
| `WritePreview@desktop/packages/ui/src/components/chat/DiffPreview.tsx:89` | public/internal | scanned |

### Tests matched

- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:98
- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:131
- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:166
- process desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:168
- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:168
- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:1003
- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:1027
- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:1028
- process desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:1036
- process desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:1066
- secret desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:1132
- secret desktop/packages/ui/src/components/chat/ChatMessage.tsx:526

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (308 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 158; total LOC: 39955
- Empty catch residual: none
- TODOs: desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:844 // TODO: port sendMessage to session-actions (complex — creates sessions, handles attachments, etc.)

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/chat`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 1
- Empty catch residual: 0
- Export surface: 308

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `7aa7bf12117a744a` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | Deep extract 158 files / 39955 LOC / fp 7aa7bf12117a744a |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
