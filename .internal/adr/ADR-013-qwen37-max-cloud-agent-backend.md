# ADR-013: Treat Qwen3.7-Max as a premium cloud-agent backend, not a Qwen-specific runtime architecture

## Status

Accepted; All phases (0-7) shipped in v5.5.0

## Date

2026-05-23

## Deciders

ax-code maintainers

## Related

- `.internal/prd/PRD-2026-05-23-qwen37-max-agent-optimization.md`
- `.internal/adr/ADR-010-alibaba-thinking-shape-and-budget-clamping.md`
- `packages/ax-code/script/update-models.ts`
- `packages/ax-code/src/provider/transform.ts`
- `packages/ax-code/src/provider/model-support.ts`
- `packages/ax-code/src/session/compaction.ts`
- `packages/ax-code/src/session/system.ts`

## Context

Qwen3.7-Max is a proprietary Alibaba/Qwen model released for cloud API use. Official and provider material positions it as an agent-focused model with:

- 1M context,
- text input/output,
- reasoning/deep-thinking support,
- recommended `preserve_thinking` for agentic tasks,
- function calling and structured outputs,
- cache support on Qwen Cloud,
- strong vendor-reported coding, MCP, terminal, spreadsheet, and reasoning benchmark scores.

A local transcript reviewed from `/Users/akiralam/Downloads/硬刚DeepSeek？Qwen3.7-Max硬核拆解.txt` reinforces the same direction from a secondary-analysis perspective: the important selection axis for agent models is not a single benchmark, but the combination of capability, cost, and long-run stability. It also repeats the official 35-hour autonomous kernel-optimization example and emphasizes cross-harness tool-use generalization.

The same transcript includes Qwen3/Qwen3.5 training and architecture discussion, such as data scale, MoE layout, QK-Norm, and training stages. Those points are useful background for why the Qwen family may be strong, but they are not accepted as Qwen3.7-Max implementation facts because Alibaba has not published the full Qwen3.7-Max technical report at the time of this decision.

`ax-code` already has several relevant foundations:

- Alibaba plan providers include `qwen3.7-max` in the curated model set.
- Alibaba OpenAI-compatible reasoning models use `enable_thinking` and a clamped `thinking_budget`.
- Compaction budgeting scales to 1M context models.
- Project memory and code-intelligence paths can supply stable repo context.
- Token accounting includes cache read/write fields when providers report them.

However, the product should not become a Qwen-specific agent harness. Qwen3.7-Max is valuable because it amplifies existing `ax-code` strengths: tool orchestration, project context, memory, verification, and autonomous task control. Those investments should remain useful for Claude, GPT, Gemini, Kimi, GLM, local models, and future Qwen releases.

The durable product asset is the `ax-code` Agent Optimization Layer:

```text
task classifier / model router
→ repo context packer
→ planner and task decomposition
→ tool-call policy
→ verifier / test runner
→ patch safety and rollback evidence
→ long-task memory and failure traces
→ cost and stability telemetry
```

The layer is optimized for Qwen3.7-Max first because that model is positioned for long-horizon tool workflows, but the boundary must stay reusable and model-agnostic.

The operating target is therefore not "highest benchmark model wins". It is "best cost per verified long-agent completion while staying stable over many tool calls".

## Decision

Treat Qwen3.7-Max as a premium cloud-agent backend behind provider-neutral orchestration contracts.

Specifically:

1. Keep core orchestration features provider-neutral:
   - task classification and model-route recommendation,
   - long-agent context packing,
   - prompt-cache policy,
   - tool-loop summarization,
   - verifier and patch-safety feedback,
   - failure memory,
   - verification feedback,
   - local evaluation harnesses.
2. Apply Qwen3.7-Max-specific request options only at provider boundaries:
   - `enable_thinking`,
   - bounded `thinking_budget`,
   - optional `preserve_thinking`,
   - provider-specific cache breakpoint rendering after route verification.
3. Do not add Qwen-specific branches inside session orchestration unless they are expressed as capability checks or provider policy objects.
4. Do not optimize `ax-engine` or local inference around Qwen3.7-Max. The model has no open weights; local inference work belongs to open-weight Qwen3.6/Qwen3.5 families.
5. Do not promote Qwen3.7-Max based only on vendor benchmarks. Use local `ax-code` evaluation tasks before making it a default premium recommendation.
6. Evaluate Qwen3.7-Max on a capability/cost/stability triangle:
   - capability: verified task completion across multi-file, tool-heavy engineering work,
   - cost: net tokens and estimated dollars per verified completion, including cache read/write accounting,
   - stability: repeated-failure avoidance, no false completion, no unrelated destructive edits, and recovery from failed tools/tests.
7. Treat unverified Qwen-family architecture or training claims as research context only. They must not drive product behavior unless confirmed by provider docs, API behavior, or local evaluation.
8. Treat traces as strategic assets. Successful patches, failed patches, tool traces, verification results, cache/cost counters, and rollback evidence should be structured for evaluation and future planner/navigation model work.
9. Do not automatically spend on cross-provider checks. Claude/GPT cross-checking is a recommendation for high-risk work only until cost and quality gates justify automation.
10. Add `Super-Long` as a supervised long-run user control, not as unbounded autonomy:
   - It appears immediately left of the existing `Autonomous` button.
   - It defaults off for all models except Qwen3.7-Max.
   - It defaults on when the active model is Qwen3.7-Max.
   - User toggles override model defaults for the current session.
   - The hard maximum ceiling is 72 hours.
   - It must enforce goal, budget, checkpoint, verifier, rollback, approval, progress-report, and stop-condition contracts.
   - It must enforce provider pacing and burst control so long runs do not overload short-window provider limits with many agents, tool calls, or model requests at once.

## Alternatives Considered

### Add only the model id

Rejected. A raw model id would make Qwen3.7-Max callable but would not leverage the capabilities that justify its cost: long-context packing, thinking continuity, cache reuse, tool feedback, and verification loops.

### Build a Qwen-specific premium mode

Rejected as the primary architecture. It would be fast to market, but it would duplicate prompt/context/tool-loop behavior and create lock-in around one proprietary cloud model. Provider-specific defaults are acceptable; provider-specific orchestration is not.

### Fine-tune Qwen3.7-Max for ax-code

Rejected as not realistic. Qwen3.7-Max is a closed API model. The practical optimization surface is the agent layer around it. Future fine-tuning work should target open-weight helper models or local planner/navigation models trained from `ax-code` traces.

### Select Qwen3.7-Max purely because it is cheaper than Opus/GPT-class models

Rejected. Lower input/output price is valuable only if it reduces the cost of verified task completion. If the model produces verbose output, repeats failed tool loops, or requires more human intervention, headline token price is misleading.

### Enable prompt caching globally

Rejected. Cache semantics differ by provider and route. Dynamic tool results, current user requests, and continuation prompts are poor cache candidates. OpenRouter documentation did not yet list Qwen3.7-Max in the Alibaba explicit-cache support list at review time, so cache behavior must be probed before default enablement.

### Raise Alibaba output and thinking caps for Qwen3.7-Max

Deferred. Qwen3.7-Max can emit large outputs, but `ax-code` currently clamps Alibaba output to protect short-window quotas. Raising this cap should be a user/account-profile decision, not a model promotion side effect.

### Use Qwen3/Qwen3.5 architecture claims to tune Qwen3.7-Max behavior

Rejected until official Qwen3.7-Max details exist. Architecture claims from secondary analysis can inform hypotheses, but request shaping and harness behavior must be based on documented API behavior, capability metadata, and local measured outcomes.

### Automatically route every difficult task to Qwen3.7-Max

Rejected for now. Route classification should start as a reviewed recommendation, not an automatic runtime switch. The system needs local eval evidence, cost accounting, and stability gates before automatic model spending is acceptable.

### Add a true non-stop mode

Rejected. Qwen3.7-Max is designed for long-horizon workflows, but product safety requires supervised long-run boundaries. `Super-Long` is allowed only as a bounded mode with explicit time/cost ceilings, provider pacing, checkpoints, verifiers, rollback evidence, approval gates, and clear stop semantics. The maximum ceiling is 72 hours; "days without supervision" is not a supported contract.

### Use bursty multi-agent execution for Super-Long

Rejected. Cloud providers can impose short-window request, token, or concurrency limits. Super-Long should not try to maximize immediate parallelism. It should schedule steady work, queue non-urgent sub-agent tasks, use jittered delays when limits are uncertain, checkpoint before long backoff, and surface rate-limit state instead of spinning the agent loop.

## Policy

- Qwen3.7-Max provider work must preserve the existing Alibaba OpenAI-compatible thinking contract from ADR-010.
- New provider features should be gated by capability, provider id, route shape, and tests.
- OpenRouter support must preserve the curated allowlist invariant: every allowed model id must exist in the committed snapshot.
- Prompt-cache breakpoints must be applied only to stable blocks and only on routes where support is verified.
- Long-agent context packing must be budgeted and tiered; 1M context is capacity, not permission to dump the repository.
- Local evaluation artifacts should separate vendor benchmark evidence from measured `ax-code` task evidence.
- Qwen3.7-Max promotion criteria must include cost-per-verified-completion and stability, not only raw success rate.
- Secondary analysis can be cited in internal planning, but only provider documentation, observed API behavior, and local evals can justify implementation defaults.
- Model routing should begin as pure, testable classification. Runtime switching can be added only after the route classes have evaluation evidence.
- Verification and rollback evidence are part of the agent contract, not optional UI affordances.
- Trace artifacts must be redaction-aware before they are used for eval reports or future training data.
- `Super-Long` requires Autonomous-mode-equivalent guardrails. If Autonomous is disabled, the runtime must either block Super-Long or enforce the same loop controls through an equivalent path.
- Qwen3.7-Max may default `Super-Long` on because the model is specifically positioned for long-horizon tool workflows; this is a model-specific UI default, not a permission to bypass budgets or approval gates.
- No Super-Long preset or config can exceed 72 hours.
- Super-Long must include provider pacing budgets for request rate, token rate, tool-call rate, and concurrent agent work. Unknown provider limits should default to conservative pacing.
- Rate-limit or overload responses must checkpoint and back off. They must not create tight retry loops, recursive agent spawning, or hidden background bursts.

## Consequences

Positive:

- Qwen3.7-Max can be used where it is strongest: long-running cloud agent workflows.
- Improvements remain useful for other premium and future models.
- Provider-specific risk is isolated to transform/policy layers.
- Cost controls remain explicit through context packing, cache policy, and Alibaba output/thinking clamps.
- The project gets a clearer model-selection framework for future premium models: capability, cost, and long-run stability.
- The same trace/eval data can later support an open-weight local planner or repo-navigation model without changing the Qwen3.7-Max API integration.

Negative or risky:

- More architecture work is required than simply exposing a model id.
- `preserve_thinking` and prompt-cache behavior need live provider verification before defaulting on.
- A provider-neutral policy layer may initially feel heavier than direct conditionals.
- Qwen3.7-Max may underperform vendor benchmarks on `ax-code` tasks; local evaluation is required before promotion.
- Capability/cost/stability scoring adds evaluation work before default promotion.
- Keeping routing recommendation-only at first delays automatic user-visible optimization, but reduces spend and regression risk.
- Default-on `Super-Long` for Qwen3.7-Max creates a stronger product signal, but it raises the bar for budget, verifier, checkpoint, and approval UX before implementation can ship.

## Follow-Up

Implement `.internal/prd/PRD-2026-05-23-qwen37-max-agent-optimization.md` in narrow phases:

1. Readiness audit for Alibaba, OpenRouter, and Together routes.
2. Qwen3.7-Max long-agent profile.
3. Thinking continuity policy for Qwen3.7-Max.
4. Prompt-cache policy and telemetry.
5. Long-agent context packing.
6. Tool-loop hardening.
7. Local evaluation harness with capability/cost/stability scoring.
8. Super-Long supervised long-run mode with TUI toggle and 72h hard ceiling.

The first coding slice should be credential-free: implement readiness classification and long-agent route/profile classification as pure helpers with unit tests, without changing runtime routing behavior or adding the `Super-Long` UI. The `Super-Long` button belongs after the profile, telemetry, verifier/checkpoint, and stop-condition contracts are ready.
