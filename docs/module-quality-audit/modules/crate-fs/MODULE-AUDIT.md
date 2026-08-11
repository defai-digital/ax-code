# MODULE-AUDIT: crate-fs

| Field | Value |
|-------|-------|
| Unit slug | `crate-fs` |
| Scope | `crates/ax-code-fs` |
| Resolved root | `crates/ax-code-fs` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native, performance |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `dd17c47e3f600c03` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 6 / 3143 |
| Inventory ID | W9-16 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-fs/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-fs/examples/bench.rs` | 156 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/detect.rs` | 1182 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/embedding.rs` | 229 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/lib.rs` | 1418 | 0 | 0 | 0 |
| `crates/ax-code-fs/src/watcher.rs` | 152 | 0 | 0 | 0 |

### Exports (sample)
- none

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (0) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags native,performance | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `dd17c47e3f600c03` |
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
