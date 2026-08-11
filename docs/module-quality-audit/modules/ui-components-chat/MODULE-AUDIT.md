# MODULE-AUDIT: ui-components-chat

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-chat` |
| Scope | `desktop/packages/ui/src/components/chat` |
| Resolved root | `desktop/packages/ui/src/components/chat` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `c5f9a604fc9c8936` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 158 / 39955 |
| Inventory ID | W8-03-02 |

## 1. Scope and map

### Source inventory

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
| `desktop/packages/ui/src/components/chat/ChatInput.tsx` | 2 | 0 | 0 | 0 |
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
| `desktop/packages/ui/src/components/chat/MarkdownRendererImpl.tsx` | 3 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/MessageList-impl.tsx` | 1853 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/MessageList.tsx` | 3 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/ModelControls.tsx` | 1942 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/chat/PendingChangesBar.tsx` | 154 | 1 | 0 | 0 |

### Exports (sample)
- `ActivityBreadcrumb@desktop/packages/ui/src/components/chat/ActivityBreadcrumb.tsx:73`
- `AllowPatternBuilder@desktop/packages/ui/src/components/chat/AllowPatternBuilder.tsx:14`
- `ChangedFilesList@desktop/packages/ui/src/components/chat/ChangedFilesList.tsx:13`
- `ChatContainer@desktop/packages/ui/src/components/chat/ChatContainer.tsx:385`
- `ChatErrorBoundary@desktop/packages/ui/src/components/chat/ChatErrorBoundary.tsx:108`
- `ChatInput@desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:4231`
- `ChatSurfaceProvider@desktop/packages/ui/src/components/chat/ChatSurfaceContext.tsx:4`
- `CommandInfo@desktop/packages/ui/src/components/chat/CommandAutocomplete.tsx:14`
- `CommandAutocompleteHandle@desktop/packages/ui/src/components/chat/CommandAutocomplete.tsx:27`
- `CommandAutocomplete@desktop/packages/ui/src/components/chat/CommandAutocomplete.tsx:57`
- `buildBuiltInCommands@desktop/packages/ui/src/components/chat/CommandAutocompleteCommands.ts:14`
- `filterCommandList@desktop/packages/ui/src/components/chat/CommandAutocompleteCommands.ts:126`
- `DiffPreview@desktop/packages/ui/src/components/chat/DiffPreview.tsx:30`
- `WritePreview@desktop/packages/ui/src/components/chat/DiffPreview.tsx:89`
- `DoneNotCommittedNudge@desktop/packages/ui/src/components/chat/DoneNotCommittedNudge.tsx:16`
- `DraftPresetChips@desktop/packages/ui/src/components/chat/DraftPresetChips.tsx:237`
- `ExecutionModeSelector@desktop/packages/ui/src/components/chat/ExecutionModeSelector.tsx:52`
- `FileAttachmentButton@desktop/packages/ui/src/components/chat/FileAttachment.tsx:17`
- `AttachedFilesList@desktop/packages/ui/src/components/chat/FileAttachment.tsx:257`
- `MessageFilesDisplay@desktop/packages/ui/src/components/chat/FileAttachment.tsx:335`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (303) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c5f9a604fc9c8936` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
