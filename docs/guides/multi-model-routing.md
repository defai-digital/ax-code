# Multi-Model Routing Best Practices

Status: Active
Scope: public, current-state
Last reviewed: 2026-11-04
Owner: ax-code runtime

This guide captures the recommended way to run ax-code with a premium reasoning model and cheaper same-provider aux models.

## Core principle

Use the expensive model for reasoning-dense work, and cheap models for mechanical or read-only work. The real savings come from **context filtering**: the premium model only sees distilled context prepared by cheaper models or subagents.

## Recommended layer split

| Layer                 | Model class                                              | Typical agents / tasks                                                  |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Worker / executor     | Connected flash SKU when available (e.g. DeepSeek Flash) | unpinned session, `build`, `general`, `scout`, `test`, `devops`, `perf` |
| Advisor / reasoning   | Stronger connected model (e.g. DeepSeek V4 Pro)          | `plan`, `architect`, `security`, `debug`                                |
| Cheap / read-only aux | Same flash SKU                                           | `explore`, `compaction`, titles, recaps, low-complexity classification  |

Pin exact `provider/model` IDs that are connected. Disabled or unavailable pins fail when used. Catalog recommendations are UI suggestions; they do not become an implicit runtime default or an automatic recovery pool. Without `config.model`, AX Code preserves the most recent explicit selection. With neither a configured nor recent selection, choose a model or pass `--model provider/model`.

Recovery targets must be explicitly authorized through `llm_routing.fallback`. See [model selection and recovery](model-recovery.md) for the current selection, retry and privacy contract.

## Config template

See `ax-code.json.example` at the repo root for a concrete DeepSeek Flash default with Pro on reasoning agents.

### Codex CLI auxiliary models

Codex model availability depends on the account's sign-in method and client, not
only the catalog's text or tool capabilities. AX Code therefore does not infer
a `codex-cli` small model from names or family metadata. Without an explicit
`small_model` or compaction-agent model, compaction uses the session model.

If you configure an auxiliary model, verify it works with the same Codex login.
An explicit Codex rejection that a model is unsupported with a ChatGPT account
allows compaction to try the session model once, skipping other small models.
The rejected attempt remains in session history. Other authentication,
billing, validation, cancellation, and context-overflow failures retain their
existing handling; the local-provider privacy guard still applies.

For an affected older installation, remove an incompatible `small_model` or
`agent.compaction.model` override and explicitly pin `agent.compaction.model`
to a model already verified with that Codex account. Changing only the visible
session model does not override a separately pinned compaction model.

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

- Auxiliary model selection is explicit: `Provider.getSmallModel()` reads `small_model`; absent that setting, callers inherit the primary model. It does not scan the catalog for a cheap tier.
- There is no mid-run escalation from a stuck worker to a stronger model.
