# Protocol Steps: control-plane

- Slug: `control-plane`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

Agent orchestration is expressed by `AgentControl` state/plan functions in `packages/ax-code/src/control-plane/agent-control.ts:3-339`, `ExecutionController` decisions in `execution-controller.ts:3-116`, completion gating in `autonomous-completion-gate.ts:4-409`, reasoning/safety policy namespaces, and replay event/summary helpers. Workspace orchestration is separately exposed through `Workspace` CRUD/sync in `workspace.ts:16-181`, adaptor registration in `adaptors.ts:5-16`, proxy context/middleware, bounded SSE parsing in `sse.ts:8-139`, and the loopback Hono listener in `workspace-server/server.ts:21-111`.

## Step 2 Threat model

The agent boundary must prevent invalid lifecycle transitions, premature completion, bypassed validation/approval, and unsafe autonomous tool decisions (`packages/ax-code/src/control-plane/agent-control.ts:134-188`, `packages/ax-code/src/control-plane/safety-policy.ts:54-241`). The workspace boundary receives adaptor-controlled HTTP/SSE data and request paths, so SSRF/header credential leakage, absolute-URL injection, oversized streams, retry storms, orphaned cleanup, and cross-workspace event attribution are central failure modes (`packages/ax-code/src/control-plane/workspace-router-middleware.ts:13-132`, `packages/ax-code/src/control-plane/workspace.ts:118-178`).

## Step 3 Correctness

`AgentControl.transition` checks the explicit phase graph and calls `assertCanComplete` so failed/pending validation or open/blocked plan work cannot reach `complete` (`packages/ax-code/src/control-plane/agent-control.ts:134-188`, `packages/ax-code/src/control-plane/agent-control.ts:191-203`). `AutonomousCompletionGate.evaluate` blocks pseudo-tool text, unusable subagent results, and active todos before allowing completion (`packages/ax-code/src/control-plane/autonomous-completion-gate.ts:53-99`). Workspace removal retains the database row when adaptor cleanup throws, sync reconnects with abort-aware exponential backoff, and proxying removes credentials/proxy headers while rejecting decoded absolute paths (`packages/ax-code/src/control-plane/workspace.ts:118-178`, `packages/ax-code/src/control-plane/workspace-router-middleware.ts:41-132`).

## Step 4 Performance

Workspace synchronization runs one job per non-worktree workspace and caps reconnect delay at 30 seconds, while `parseSSE` caps an unfinished message at 1 MiB (`packages/ax-code/src/control-plane/workspace.ts:134-178`, `packages/ax-code/src/control-plane/sse.ts:5-107`). The workspace server caps each subscriber queue at 1,024 frames and forwarding limits headers by count, per-header bytes, and aggregate bytes (`packages/ax-code/src/control-plane/workspace-server/server.ts:54-78`, `packages/ax-code/src/control-plane/workspace-router-middleware.ts:13-56`); policy scans are linear in messages/tasks/patterns and operate on turn-sized collections.

## Step 5 Design

The directory contains two related but distinct subdomains—agent-control policy and remote-workspace transport—so cohesion at the folder level is weaker than the individual files, though branded IDs and replay events provide shared control-plane vocabulary (`packages/ax-code/src/control-plane/schema.ts:3-6`, `agent-control-events.ts:6-194`). Repository-wide call-site review found `ExecutionController`, `WorkspaceContext`, and `WorkspaceRouterMiddleware` used only by their focused tests, while reasoning, safety, events, and completion gating are integrated elsewhere; the dormant surfaces should not be cited as production enforcement until wired.

## Step 6 Dead code/hygiene

No TODO, FIXME, or empty catch appears in the 17 implementation files, and corrupt workspace rows are skipped with a warning rather than silently ignored (`packages/ax-code/src/control-plane/workspace.ts:100-115`). The test-only production call-site footprint of `packages/ax-code/src/control-plane/execution-controller.ts` and `workspace-router-middleware.ts` is the main hygiene concern, while adaptor installation itself occurs only in control-plane tests even though lookup is used by live workspace code.

## Step 7 Tests

`packages/ax-code/test/control-plane/agent-control.test.ts`, `execution-controller.test.ts`, `autonomous-completion-gate.test.ts`, and `safety-policy.test.ts` exercise phase, completion, failure, protected-path, and blast-radius decisions. `sse.test.ts`, `session-proxy-middleware.test.ts`, `workspace-sync.test.ts`, `workspace-remove.test.ts`, `workspace-recovery.test.ts`, and `workspace-server-sse.test.ts` cover bounded parsing, path/header filtering, reconnect/abort, cleanup, and queue behavior. The key gap is a production integration test proving the currently test-only controller/router surfaces are actually installed in an application path.

## Step 8 Findings

`docs/module-quality-audit/modules/control-plane/MODULE-AUDIT.md` registers no accepted finding, and no new Critical or High defect was established. The unwired controller/router surfaces are specifically recorded as design and integration-test gaps, not findings, because their policies behave correctly in direct tests and no production caller currently claims to rely on them.

## Step 9 Verification

I ran a focused audit/control-plane Vitest selection; ten files and 104 tests passed, including `packages/ax-code/test/control-plane/agent-control.test.ts`, `execution-controller.test.ts`, `safety-policy.test.ts`, `sse.test.ts`, and `workspace-sync.test.ts`. `pnpm --dir packages/ax-code run typecheck` also passed; before activating adaptor routing, I would additionally run `session-proxy-middleware.test.ts`, `workspace-remove.test.ts`, `workspace-recovery.test.ts`, and `workspace-server-sse.test.ts` together.
