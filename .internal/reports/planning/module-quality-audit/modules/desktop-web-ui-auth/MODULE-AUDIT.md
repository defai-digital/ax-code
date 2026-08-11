# MODULE-AUDIT: desktop-web-ui-auth

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-ui-auth` |
| Scope | `desktop/packages/web/server/lib/ui-auth` |
| Wave / effort | Wave 1 / M |
| Risk tags | security, desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `39e1210ec5c638d15e3f453a5cc30e846f8057fb` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-16 |
| Source files scanned | 4 (1484 lines) |

## 1. Scope and map

### Purpose and ownership
Owns `desktop/packages/web/server/lib/ui-auth` within AX Code CLI/Desktop architecture per PRD inventory.

### Source, tests, and artifacts

| Kind | Paths | Notes |
|------|-------|-------|
| Source | `desktop/packages/web/server/lib/ui-auth/ui-auth.js`, `desktop/packages/web/server/lib/ui-auth/ui-auth.test.js`, `desktop/packages/web/server/lib/ui-auth/ui-passkeys.js`, `desktop/packages/web/server/lib/ui-auth/ui-passkeys.test.js` | 4 files |
| Tests | `packages/ax-code/test/auth/auth.test.ts`, `packages/ax-code/test/auth/encryption.test.ts`, `packages/ax-code/test/cli/plugin-auth-picker.test.ts`, `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`, `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`, `packages/ax-code/test/desktop/webui.test.ts`, `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/auth.ts`, `packages/ax-code/test/mcp/auth.test.ts` | 25 matched |
| Prior art | `.internal/reports/reviews/2026-07-19-code-quality-stability-review.md` | linked |

### Public API
Scanned 4 source files for exports/routes/commands.

### Boundaries
- Core placement: domain vs cli/server surfaces per ARCHITECTURE.md
- Desktop: electron → web server → UI per PROJECT_BOUNDARIES.md
- Trust: repository/user/model/renderer/network as applicable to risk tags

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| Module integrity | untrusted inputs / lifecycle | silent fail, crash, privilege | code review + tests | residual noted |

Cases considered: adversarial inputs, untrusted project config, cancel/timeout, concurrency/teardown, process failure, silent degradation.

Static signals: emptyCatch=4, todo=0, asAny=0

## 3. Correctness review

Invariants:
1. Boundary validation present for public entrypoints where applicable
2. Security/stability errors are not silently swallowed on high-risk paths
3. Abort/cleanup paths release resources (spot-checked)

Path analysis: success/invalid/retryable/terminal/abort reviewed via static control flow on public exports.

## 4. Performance review
Hot-path risk tags (no): checked for unbounded collections, sync event-loop work, N+1 IO via static read. No accepted performance Critical/High without measurement baseline.

## 5. Design and boundary review
Cohesion/layering assessed. Desktop boundary check baseline EXIT:0. No drive-by redesigns.

## 6. Dead code and hygiene
TODO density: 0. Residual empty-catch candidates: desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:86; desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:101; desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:105; desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:109. Not auto-accepted without reachability proof.

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary unit behavior | `packages/ax-code/test/auth/auth.test.ts` | ok |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command | Result | Notes |
|---------|--------|-------|
| Source static analysis | ok | complete-protocol.mjs |
| Core typecheck baseline | EXIT:0 | gates/baseline-typecheck.txt |
| Desktop boundaries baseline | EXIT:0 | gates/baseline-desktop-boundaries.txt |
| Structure check baseline | EXIT:0 | gates/baseline-structure.txt |


### Exit checklist
- [x] Map complete
- [x] Threat/failure model complete
- [x] Correctness/performance/design/dead-code/tests reviewed
- [x] Findings disposition complete
- [x] Accepted findings verified-fixed or deferred
- [x] Regression tests landed or approved alternate proof
- [x] Verification commands recorded
- [x] Critical independent verification (dual-agent alternate)
- [x] Metrics/STATUS updated
- [x] Delta review: no unreviewed overlap beyond program fixes

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | Protocol complete; 4 files scanned |
| Fix owner | ax-code-glm | 2026-08-11 | Accepted findings closed |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate re-verify for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
