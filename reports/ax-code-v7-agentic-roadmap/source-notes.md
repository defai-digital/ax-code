# AX Code v7 Agentic Platform Roadmap — Source Notes

Snapshot: 2026-07-13 (America/Toronto)

## Decision frame

- Audience: AX Code product and engineering leadership.
- Decision: how to sequence v7.1, v7.2, and v7.3 so AX Code evolves from an AI coder into a reliable agentic coding platform.
- Baseline: current AX Code `main` at `5630c6e3`, HomeRail `main` reviewed on 2026-07-13, and current primary-source research/product documentation.
- Success means: higher verified task completion and engineering throughput with bounded cost, recoverable execution, inspectable evidence, and enforceable security policy.

## Local AX Code evidence

Reviewed:

- `docs/modes.md`
- `docs/autonomous.md`
- `docs/sandbox.md`
- `packages/ax-code/src/mode/arena.ts`
- `packages/ax-code/src/mode/council.ts`
- `packages/ax-code/src/mode/debate.ts`
- `packages/ax-code/src/mode/implement-arena.ts`
- `packages/ax-code/src/tool/arena-implement.ts`
- `packages/ax-code/src/workflow/spec.ts`
- `packages/ax-code/src/workflow/scheduler.ts`
- `packages/ax-code/src/workflow/eval-corpus.ts`
- `packages/ax-code/src/replay/replay.ts`

Verification run on 2026-07-13:

- Workflow/spec/scheduler/eval/replay/routes: 5 files, 77 tests passed.
- Arena/Council/mode/tool tests: 15 files, 91 tests passed.
- Worktree remained clean after the test runs.

Current strengths:

- Durable sessions and resumable subagents.
- Council with provider diversity, independent first round, optional anonymous debate, budget gates, and retained dissent tiers.
- Arena plan and implement modes; implement candidates run in separate Git worktrees, are snapshotted to branches, verified, ranked verify-first, and never auto-merged.
- WorkflowSpec v1 already covers phases, dependencies, fan-out, verification, model roles, budgets, permissions, artifacts, write policies, and multiple merge strategies.
- OS sandboxing, permission controls, MCP/tool infrastructure, replay event reconstruction, and verification envelopes.

Current gaps that shape the roadmap:

- Workflow runtime remains gated by `AX_CODE_WORKFLOW_RUNTIME=1`.
- The built-in workflow eval corpus has one named seeded case.
- Council groups findings by normalized exact location/category/summary keys; semantic-equivalent wording can remain split, while support does not validate whether evidence is correct.
- Council provider-family diversity is a useful heuristic but is not measured error independence.
- Arena verification depends on detected project commands; passing available checks may still under-test task intent.
- Arena risk is partly model-supplied, and patch fingerprints detect exact diff duplication rather than semantic solution diversity.
- Replay reconstructs recorded streams and detects divergence; it is not yet a clean-environment model rerun or side-effect simulation.

## HomeRail evidence

- Repository and README: https://github.com/xiaotianfotos/homerail
- Roadmap: https://github.com/xiaotianfotos/homerail/blob/main/ROADMAP.md
- DAG patterns: https://github.com/xiaotianfotos/homerail/blob/main/docs/dag-patterns.md
- Replay implementation: https://github.com/xiaotianfotos/homerail/blob/main/homerail_manager/src/server/replay.ts
- Evaluation implementation: https://github.com/xiaotianfotos/homerail/blob/main/homerail_manager/src/server/eval.ts
- Security design: https://github.com/xiaotianfotos/homerail/blob/main/docs/control-plane-security.md

Decision-relevant interpretation:

- HomeRail's useful contribution is a run-centric DAG control plane with explicit handoffs, typed workflow contracts, deterministic gateways, durable approvals, recovery, patterns, and inspectable run state.
- Its public product maturity is very early: public history began in July 2026, version 0.1.0, no release, and several roadmap items remain exploratory.
- Its replay/eval labels overstate current semantics if interpreted as full re-execution or benchmark-quality evaluation.
- AX should learn the control-plane semantics without importing HomeRail's Manager/Node/Worker stack or voice-first product assumptions.

## External research and product evidence

### Multi-agent task fit

- Google Research, “Towards a science of scaling agent systems: When and why agent systems work” (2026-01-28): https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
  - Controlled evaluation of 180 agent configurations.
  - Centralized coordination improved a parallelizable Finance-Agent task by 80.9% over single-agent.
  - All tested multi-agent variants degraded sequential PlanCraft performance by 39–70%.
  - Independent multi-agent execution amplified errors by up to 17.2x; centralized orchestration contained amplification to 4.4x.
  - Tool-dense tasks impose an increasing coordination tax.

- Anthropic, “How we built our multi-agent research system” (2025-06-13): https://www.anthropic.com/engineering/multi-agent-research-system
  - Multi-agent research improved an internal breadth-first research evaluation by 90.2%.
  - Agents use roughly 4x chat tokens and multi-agent systems roughly 15x chat tokens.
  - Anthropic explicitly says most coding tasks have fewer truly parallelizable subtasks than research.
  - Production reliability requires checkpoints, resumability, tracing, bounded delegation, and outcome/end-state evaluation.

### Coding-agent platform patterns

- OpenAI, “Harness engineering: leveraging Codex in an agent-first world” (2026-02-11): https://openai.com/index/harness-engineering/
  - Agent productivity depends on repository legibility, mechanical architecture constraints, worktree-local environments, observability, tests, and feedback loops.

- OpenAI, “An open-source spec for Codex orchestration: Symphony” (2026-04-27): https://openai.com/index/open-source-codex-orchestration-symphony/
  - Uses the issue tracker as a state machine/control plane, creates one workspace per task, restarts stalled agents, and keeps humans focused on deliverable review.

- OpenAI, “The next evolution of the Agents SDK” (2026-04-15): https://openai.com/index/the-next-evolution-of-the-agents-sdk/
  - Separates the agent harness from sandbox compute, keeps credentials outside model-generated-code environments, and supports snapshot/rehydration.

- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
  - Fresh isolated contexts, scoped tools/MCP, resumable subagents, project memory, and subagent-scoped hooks.

- Claude Code hooks: https://code.claude.com/docs/en/hooks
  - Lifecycle events and pre-tool allow/deny/ask/defer/argument-rewrite controls.

- GitHub Copilot hooks: https://docs.github.com/en/copilot/concepts/agents/hooks
- GitHub Copilot custom agents and subagent orchestration: https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents

### Durable orchestration reference

- LangGraph persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- LangGraph time travel: https://docs.langchain.com/oss/python/langgraph/use-time-travel
  - Checkpoint each step, resume after failure, retain successful parallel writes, and fork from a prior checkpoint while re-executing downstream calls.

### Evaluation evidence

- OpenAI, “Separating signal from noise in coding evaluations” (2026-07-08): https://openai.com/index/separating-signal-from-noise-coding-evaluations/
  - SWE-bench Verified no longer provides a clean frontier signal.
  - Human review found roughly 34% of the audited SWE-Bench Pro public split broken, including strict tests, underspecified prompts, and low-coverage tests.
  - The implication is to maintain fresh first-party tasks and audit evaluator quality, not depend on one public leaderboard.

- OpenAI SWE-Lancer: https://openai.com/index/swe-lancer/
  - More than 1,400 real freelance tasks with end-to-end tests reviewed by experienced engineers; useful as a realism reference, not a substitute for AX-specific evals.

### Security and identity

- NIST agent identity and authorization initiative: https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents
  - Calls out identification, authentication, least privilege, delegated authority, auditing, non-repudiation, and prompt-injection mitigation.

- OWASP Agentic Threats Navigator: https://genai.owasp.org/resource/owasp-gen-ai-security-project-agentic-threats-navigator/
- OWASP memory/context poisoning: https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/
  - Persistent memory, hooks, summaries, and peer-agent handoffs are security-relevant state and must not be treated as automatically trusted.

## KPI definitions proposed for v7

- Verified Task Success Rate (VTSR): eligible tasks whose task-specific acceptance evaluator passes and whose regression guardrails pass, divided by all eligible attempted tasks. Report by task class, mode, model, and cost band.
- Human Attention per Accepted Change (HAAC): active human review, intervention, and steering minutes divided by changes accepted after verification.
- Cost per Accepted Change (CPAC): model, sandbox, and external tool cost divided by accepted verified changes.
- Recovery Success Rate: forced-failure runs that resume from the latest safe checkpoint and reach a valid terminal state without restarting completed work.
- Routing Precision: router-selected multi-agent runs that beat or match the single-agent counterfactual under the configured quality/cost utility function.
- Unsafe Action Escape Rate: policy-relevant actions that executed despite a deny/escalate policy divided by all policy-relevant actions; release target is zero in the controlled security suite.

## Assumptions and caveats

- AX user telemetry, production cost data, acceptance rates, and human-review time were not available. Numeric release gates are therefore proposed engineering gates, not forecasts.
- External research results are task- and harness-dependent. They support architecture principles, not direct estimates of AX uplift.
- The roadmap assumes v7.0 Arena/Council behavior remains compatible and that v7.1 can add common run/evidence contracts without a UI rewrite.
- Any automatic mode routing should remain shadow-only until AX's own counterfactual evals show a stable benefit.
