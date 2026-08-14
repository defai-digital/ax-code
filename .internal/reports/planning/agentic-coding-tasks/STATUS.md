# Status: Agentic Coding Task Supervision

| Field | Value |
|-------|-------|
| Last updated | 2026-08-14 |
| Active phase | Phase 5 — CLI / Desktop |
| Overall | Phase 4 shipped; next is operator CLI |

---

## Snapshot

| Phase | Status |
|-------|--------|
| 0 Documentation | DONE |
| 1 Ship existing abilities | DONE |
| 2 Non-blocking `task` | DONE |
| 3 Push completion | DONE |
| 4 Cancel / concurrency / restart | DONE |
| 5 CLI / Desktop | TODO |

---

## Verify commands

```bash
cd packages/ax-code
AX_TEST_FILES=test/cli/tui/subagent-status-view.test.ts,test/tool/task.test.ts,test/session/task-queue.test.ts,test/session/background-subagent-handoff.test.ts,test/session/background-subagent-control.test.ts,test/control-plane/autonomous-completion-gate.test.ts pnpm exec vitest run
```

---

## Notes

- Competitive review (2026-08-14): OpenClaw for ledger/push/cancel; OpenCode/Grok Build/Codex for coding-CLI spawn UX.
- Unrelated working-tree changes (Ornith transform, Auto labels) are **out of this program**.
