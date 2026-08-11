# MODULE-AUDIT: question

| Field | Value |
|-------|-------|
| Unit slug | `question` |
| Scope | `packages/ax-code/src/question` |
| Resolved root | `packages/ax-code/src/question` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | correctness |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `c0d9062ddf45c8e1` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 4 / 583 |
| Inventory ID | W3-10 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/question/autonomous.ts` | 145 | 8 | 0 | 0 |
| `packages/ax-code/src/question/clarify.ts` | 158 | 7 | 0 | 0 |
| `packages/ax-code/src/question/index.ts` | 274 | 21 | 0 | 0 |
| `packages/ax-code/src/question/schema.ts` | 6 | 2 | 0 | 0 |

### Exports (sample)
- `AutonomousQuestion@packages/ax-code/src/question/autonomous.ts:1`
- `OptionLike@packages/ax-code/src/question/autonomous.ts:2`
- `QuestionLike@packages/ax-code/src/question/autonomous.ts:7`
- `Answer@packages/ax-code/src/question/autonomous.ts:14`
- `Confidence@packages/ax-code/src/question/autonomous.ts:15`
- `Decision@packages/ax-code/src/question/autonomous.ts:17`
- `decisions@packages/ax-code/src/question/autonomous.ts:137`
- `answers@packages/ax-code/src/question/autonomous.ts:141`
- `QuestionInfoShape@packages/ax-code/src/question/clarify.ts:13`
- `ClarifyHint@packages/ax-code/src/question/clarify.ts:65`
- `detectAmbiguity@packages/ax-code/src/question/clarify.ts:79`
- `shouldClarify@packages/ax-code/src/question/clarify.ts:104`
- `ClarifyOption@packages/ax-code/src/question/clarify.ts:108`
- `ClarifyInput@packages/ax-code/src/question/clarify.ts:113`
- `build@packages/ax-code/src/question/clarify.ts:135`
- `Question@packages/ax-code/src/question/index.ts:15`
- `Info@packages/ax-code/src/question/index.ts:27`
- `Info@packages/ax-code/src/question/index.ts:36`
- `Request@packages/ax-code/src/question/index.ts:38`
- `Request@packages/ax-code/src/question/index.ts:51`

### Tests
- `packages/ax-code/test/cli/tui/p-permission-question-reply-sdk-error.test.ts`
- `packages/ax-code/test/question/autonomous.test.ts`
- `packages/ax-code/test/question/clarify.test.ts`
- `packages/ax-code/test/question/question.test.ts`
- `packages/ax-code/test/tool/question.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (38) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c0d9062ddf45c8e1` |
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
