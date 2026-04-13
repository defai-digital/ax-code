# ADR: Autonomous Coding Decision Policy

## Status

Accepted

## Context

User feedback says autonomous mode should not stop on routine multi-choice questions because many users do not know which option is best and prefer the agent to decide first, continue the job, and report the decision afterward.

The previous autonomous question behavior selected the first option. That kept headless sessions moving, but it did not encode the product intent: choose industry/common best practices, avoid over-engineering, and preserve auditability.

The main competing forces are:

- More autonomy reduces approval fatigue and makes long-running coding tasks practical.
- More autonomy can amplify a bad assumption if the decision is not recorded or bounded.
- Asking the user is safer for high-risk choices, but frequent prompts reduce the value of autonomous mode.
- Always creating heavyweight PRD/ADR files would itself become over-engineering for small bug fixes.

## Decision

Autonomous mode should decide routine questions using a best-practice heuristic, then record the selected answers in tool output so the agent can summarize them at the end.

The heuristic should:

- Prefer options marked recommended, default, safe, standard, common, conventional, best practice, industry, simple, minimal, pragmatic, or least complex.
- Penalize options marked experimental, risky, dangerous, destructive, manual, advanced, deprecated, complex, over-engineer, large refactor, or rewrite.
- Treat risk/over-engineering markers as stronger than a recommended label.
- Fall back to the first option only when there is no stronger signal, because the question tool instructs callers to put their recommendation first.

Autonomous mode should also add a PRD/ADR-style decision frame to the agent workflow before implementation:

- For substantial multi-file, architectural, or product-visible changes, create or update a repo document when that matches the repository's documentation pattern.
- For trivial changes, keep the PRD/ADR frame lightweight in the plan instead of creating permanent docs.
- Prefer the simplest common-practice change that solves the task and avoid new abstractions unless there are at least 3 concrete use cases.

## Consequences

Positive:

- Headless and long-running sessions keep moving without waiting for users to resolve common implementation choices.
- The agent's choices become more aligned with common engineering practice and less biased toward broad rewrites.
- Final answers can report autonomous choices because the question tool output explicitly records them.
- The workflow improves planning quality without forcing large permanent docs for small tasks.

Negative:

- A keyword heuristic can still misclassify poorly worded options.
- The decision record currently lives in tool output, not a structured session-level ledger.
- Some ambiguous product choices will still be made automatically unless the option labels make risk clear.

## Follow-Up

- Add a structured autonomous-decision ledger to question tool metadata first; promote it to session metadata only after dashboard/replay use cases need cross-tool aggregation.
- Add configurable autonomous policy profiles such as `balanced`, `fast`, and `strict`.
- Add evaluation fixtures for autonomous question choices and over-engineering avoidance.
