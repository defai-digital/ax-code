# Architecture Direction Review

Date: 2026-04-02

Reviewed comment: the thesis is mostly right, but it needs to be sharpened against the current `ax-code` codebase.

## Verdict

The core recommendation is correct:

- do not keep stacking more agents, prompts, and tools
- move from “feature-rich coding agent” toward a more reliable execution system
- invest in workflow selection, semantic state, and verification

But the comment overstates parts of the current architecture.

The current codebase is not yet:
- a workflow orchestrator
- a persistent semantic system
- a verification-first patch engine

It is closer to:
- a capable agent shell with strong platform primitives
- a keyword router
- static repo-summary context
- on-demand LSP tooling
- a planner module that exists, but is not central to runtime execution

## What the Comment Gets Right

### 1. The main problem is not feature count

This is correct.

The README already positions `ax-code` as:
- provider-agnostic
- LSP-first
- agent auto-routing
- AX.md context
- memory warmup
- planning
- session persistence
- MCP
- 25+ tools

References:
- [README.md](/Users/akiralam/code/ax-code/README.md)

Adding more surface area without improving decision quality and execution reliability will mostly increase complexity.

### 2. The current router is still shallow

This is strongly supported by the code.

The router in [router.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/agent/router.ts) is keyword and regex based. It selects between topic agents like `security`, `architect`, `debug`, and `perf`.

It does not consider:
- repo structure
- file graph
- diagnostics state
- test failure shape
- edit blast radius
- confidence from actual code evidence

The comment is right that this should evolve from agent selection to execution-path selection.

### 3. The memory system is still static summary memory

This is also correct.

The current memory generator in [generator.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/memory/generator.ts) mainly captures:
- directory structure
- README summary
- config summary
- coarse tech stack detection

The injector in [injector.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/memory/injector.ts) only formats those sections.

This is useful for cold-start context, but it is not engineering memory in the stronger sense described in the comment.

### 4. LSP-first is not the same as semantic-system-first

Correct.

The LSP tool in [lsp.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/tool/lsp.ts) is an on-demand query interface over:
- definition
- references
- hover
- symbols
- call hierarchy

The LSP runtime in [lsp/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/lsp/index.ts) does persist live clients and diagnostics, but there is no repo-level semantic index that planner/router/editor all consume as a shared decision substrate.

So the comment’s recommendation is valid: the next level is not “more LSP tools”, it is “turn LSP output into persistent decision data”.

## What the Comment Overstates or Misses

### 1. Auto-routing is even weaker than the comment implies

The comment says routing often stays at prompt-level intelligence.

That is true, but the current implementation is even more basic than that:
- it is not prompt-understanding-driven
- it is mostly keyword and regex matching in [router.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/agent/router.ts)

This means the first upgrade should not be a “smarter persona router”.
It should be a task classifier that chooses execution strategy.

### 2. The planner is not yet part of the main runtime loop

The comment frames planning as if it is already a real execution spine.

In the current code, the planner exists in [planner/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/planner/index.ts), but there is no meaningful integration into the main session execution path.

The verification module in [planner/verification/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/planner/verification/index.ts) is also lightweight:
- mostly `npx tsc --noEmit`
- optional custom commands

So this area is not yet “verification-first editing”. It is scaffolding, not the runtime center.

### 3. Memory may not currently be delivering as much runtime value as the README suggests

Important gap:
- the memory module exists
- the injector exists
- but there is no obvious runtime call site wiring memory into the main prompt assembly path

By contrast, AX.md and instruction files are clearly loaded in [instruction.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/session/instruction.ts).

So the problem is not only that memory is too static.
It may also be under-integrated.

### 4. “Enterprise-grade coding system” is directionally good, but slightly too marketing-led

The stronger product framing is:

`reliability-first, policy-aware, semantics-assisted coding system`

Why:
- “enterprise” is useful for go-to-market
- but the architecture work is really about reliability, bounded execution, auditability, and governed change

That framing keeps the roadmap grounded.

### 5. Patch ranking is promising, but it is not the first thing to build

The comment is right that reranking candidate patches could be valuable.

But doing that before:
- better task/workflow routing
- better verification planning
- better semantic state

will mostly rank weak candidates against other weak candidates.

Patch ranking is a P1/P2 multiplier, not the foundation.

## Current State Summary

### Strong foundations already present

- durable session and tool/event model in `session/`
- real permissions model
- good provider abstraction
- LSP client management
- MCP integration
- TUI/app surfaces
- structured agent catalog and permissions

### Main architectural gaps

- router chooses agents, not workflows
- no shared task/evidence model
- memory is static and likely under-integrated
- no persistent semantic cache for planner/router/editor
- verification is not mandatory or deeply task-shaped
- no candidate-patch evaluation layer

## Recommendation

The best next abstraction is not “more agents”.

It is:

`semantic workflow engine`

That means:
- classify the task
- gather evidence deliberately
- choose a bounded edit strategy
- choose verification before editing
- record outcomes for future routing

## Revised Priority Order

### P0

#### 1. Replace agent-first routing with workflow-first routing

Build a runtime classifier that chooses an execution path, not just an agent.

Suggested layers:
- task classifier
- evidence planner
- edit strategy selector
- verification planner
- failure policy

Examples:
- read-only architecture review
- targeted bug-fix workflow
- typed refactor workflow
- documentation/research workflow
- risky cross-module change workflow

#### 2. Make verification a first-class pre-edit decision

Before editing, determine:
- what will be run to validate
- what success means
- when to stop
- when to rollback or retry

This should be attached to the execution plan, not bolted on after patching.

#### 3. Build a persistent semantic cache

Do not jump straight to a giant graph platform.

Start with a cached repo semantic layer containing:
- file-to-symbol index
- symbol-to-definition
- references summary
- diagnostics snapshot
- import graph
- changed-file impact hints

Then feed this into:
- routing
- planning
- edit scoping
- verification selection

### P1

#### 4. Upgrade memory into layered engineering memory

Recommended layers:
- repo identity
- architecture memory
- symbol memory
- execution memory

This is a better version of the comment’s suggestion.

Most valuable first:
- architecture memory
- execution memory

because they influence behavior, not just prompt quality.

#### 5. Add boundary-aware governance

AX.md should evolve from generated project summary into partially governed policy input.

Examples:
- safe edit zones
- protected zones
- verification policy
- required checks
- ownership or review hints

This is more realistic than treating AX.md as full enterprise governance today.

#### 6. Add failure memory

Record:
- commands that frequently fail
- flaky validations
- risky directories
- edit patterns that regress often
- workflows that succeed for each task class

This improves routing quality much faster than adding more personas.

### P2

#### 7. Candidate patch ranking

After the semantic cache and verification planner exist, add:
- 2-4 candidate patch generation for higher-risk tasks
- cheap structural scoring
- verification-aware reranking

Ranking dimensions:
- syntax/type validity
- diagnostic alignment
- blast radius
- files touched
- conformance to policy boundaries

#### 8. Heavier multi-agent parallelism

The caution in the comment is correct.

Do not expand swarm-style parallelism until:
- workflow orchestration is stable
- semantic context is shared
- verification and ownership are explicit

Otherwise parallelism mostly magnifies coordination errors.

## Practical Roadmap

### Phase 1: make the runtime honest about what it is doing

- Introduce task classes and workflow types
- Log chosen workflow, evidence sources, and verification plan
- Keep existing agents, but make them implementation details behind workflows

### Phase 2: semantic cache

- Add cache generation and invalidation
- Store repo semantic summaries locally
- Expose a small internal query API for router/planner/editor

### Phase 3: verification-first execution

- require a verification plan for mutation workflows
- route simple tasks to cheap checks
- route risky refactors to stronger checks

### Phase 4: memory and governance upgrade

- turn AX.md + memory into layered memory + policy inputs
- add protected zones / boundary metadata
- add failure memory

### Phase 5: patch ranking

- only after the earlier layers are stable

## If Only Three Things Get Built

Build these:

1. workflow router
2. persistent semantic cache
3. verification-first mutation flow

That is the smallest set that materially changes `ax-code` from “many features” into “better system behavior”.

## Bottom Line

The comment’s direction is good.

Its strongest points are:
- stop stacking agents/tools
- upgrade routing into workflow selection
- turn LSP output into core decision data
- prioritize governed, reliable execution

The main refinement is:
- `ax-code` is not yet as integrated as the comment assumes
- memory and planning are less central in the runtime than the README suggests
- so the next move should be foundational architecture work, not another layer of agent specialization
