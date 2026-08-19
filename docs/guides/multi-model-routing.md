# Multi-Model Routing Best Practices

Status: Active
Scope: public, current-state
Last reviewed: 2026-08-19
Owner: ax-code runtime

This guide captures the recommended way to run ax-code with a premium reasoning model and cheaper same-provider aux models.

## Core principle

Use the expensive model for reasoning-dense work, and cheap models for mechanical or read-only work. The real savings come from **context filtering**: the premium model only sees distilled context prepared by cheaper models or subagents.

## Recommended layer split

| Layer | Model class | Typical agents / tasks |
| --- | --- | --- |
| Worker / executor | Strong general flagship (e.g. Qwen3.8 Max) | `build`, `general`, `scout`, `test`, `devops`, `perf` |
| Advisor / reasoning | Reasoning model (e.g. DeepSeek V4 Pro, Claude Opus) | `plan`, `architect`, `security`, `debug` |
| Cheap / read-only aux | Same-provider flash/mini (e.g. DeepSeek V4 Flash) | `explore`, `compaction`, titles, recaps, low-complexity classification |

## Config template

See `ax-code.json.example` at the repo root for a concrete DeepSeek + Alibaba example.

## Task-type auto-routing rules

Do **not** auto-route all low-value tasks to a cheap model. Split them by failure cost:

- **Safe to auto-route** (read-only or human-reviewable):
  - repository exploration, grep/search triage, file classification
  - code summarization, log summarization, code explanation
  - preparing context for the premium model
  - documentation
- **Opt-in only** (mechanically verifiable but can hide behavior changes):
  - boilerplate, lint fixes
- **Never auto-route by default** (silent errors are expensive):
  - unit tests
  - rename/refactor
  - simple SQL
  - API wrapper
  - simple CRUD

The last group should stay on the session model unless the user explicitly pins a cheaper model.

## Operating manual

1. Start non-trivial tasks in `plan` mode so the advisor validates the design before the worker writes code.
2. If the worker loops or fails verification twice, switch to `debug` with the failing signal.
3. Use `council` for independent diagnosis when two fixes are plausible, not to finish the task.
4. Reserve manual model switches for rare reasoning-heavy turns; switch back afterward.

## Known ax-code limitations

- `Provider.getSmallModel()` currently returns `undefined` for some providers (e.g. DeepSeek) because the hardcoded priority lists do not match their catalogs.
- `compaction` bypasses `small_model` and falls back to the session model unless `agent.compaction.model` is pinned.
- Complexity-based routing (`routing.llm`) is documented as default-on but is gated by `AX_CODE_SMART_LLM`, which defaults off.
- There is no mid-run escalation from a stuck worker to a stronger model.

## Future code improvements

These are the minimal, low-risk changes that would make the above config automatic:

1. Derive the small model from catalog `family` metadata instead of hardcoded substring lists, with `tool_call` and context-limit guards.
2. Add `routing.auto_small_model` (default `false`) to opt into same-provider cheap-model routing for unpinned read-only lanes.
3. Make `compaction` respect `small_model`.
4. Surface every automatic model swap via the existing `Recorder.emit({type: "agent.route"})` + toast path.

Until those land, use explicit `small_model` and per-agent `model` pins as shown in `ax-code.json.example`.
