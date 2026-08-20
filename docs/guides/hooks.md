# Lifecycle Hooks

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-26  
Owner: ax-code runtime

Lifecycle hooks let you run shell commands on agent events without rebuilding the runtime. They complement permission rules and the isolation sandbox: **hooks are deterministic side effects** (“always format”, “never force-push”), while prompts remain advisory.

## Events

| Event                | When                                                                                                                                                                               | Can block?                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **PreToolUse**       | Before a tool executes                                                                                                                                                             | Yes (`blockOnFailure: true`) |
| **PostToolUse**      | After a tool completes                                                                                                                                                             | No                           |
| **Stop**             | When a session turn completes (packs may run on stop via automation)                                                                                                               | No                           |
| **UserPromptSubmit** | When a user prompt is submitted, before the message is persisted                                                                                                                   | Yes (`blockOnFailure: true`) |
| **PreCompact**       | Before session compaction runs (`args`: `{ auto, overflow }`)                                                                                                                      | No                           |
| **SubagentStop**     | When a `task` subagent finishes (`args`: `{ agent, status }`)                                                                                                                      | No                           |
| **SessionStart**     | When a top-level session is created (`args`: `{ sessionID, title, time }`)                                                                                                         | No                           |
| **SessionEnd**       | When a session is removed or archived (`args`: `{ sessionID, reason }`, `reason` is `"remove"` or `"archive"`)                                                                     | No                           |
| **PostCompact**      | After a session compaction completes successfully (`args`: `{ sessionID, reason }`, `reason` is `"auto"` or `"manual"`; not fired when compaction bails, e.g. on context overflow) | No                           |
| **Interrupt**        | When a user or operator explicitly cancels a running turn (`args`: `{ sessionID }`; not fired on normal turn completion or internal cleanup)                                       | No                           |

The four session lifecycle events (`SessionStart`, `SessionEnd`, `PostCompact`, `Interrupt`) are observation-only: they fire and forget, never block the lifecycle path, and their payloads carry ids/reasons/timestamps only — never conversation text, summaries, or tool output. Subagent sessions do not fire `SessionStart` (they already surface via `SubagentStop`).

These names map to AX Code’s internal plugin triggers (`tool.execute.before` / `tool.execute.after`) plus session-level prompt, compaction, subagent, and stop hooks. Synthetic continuation prompts (internal `agentRouting: "preserve"` prompts) do not fire `UserPromptSubmit`.

## Enable packs

Project hooks and plugins execute repository-controlled code, so `.ax-code/hooks.json`, `.ax-code/plugin/`, and project-configured plugins are disabled by default. After reviewing them, opt in outside the repository when starting AX Code:

```bash
AX_CODE_TRUST_PROJECT_CONFIG=1 ax-code
```

Then create `.ax-code/hooks.json` in your project:

```json
{
  "packs": ["format-after-edit", "block-force-push", "require-tests-on-stop", "protect-env-files", "log-bash-commands"]
}
```

## Official packs (≥5)

| Pack                    | Events      | Description                             |
| ----------------------- | ----------- | --------------------------------------- |
| `format-after-edit`     | PostToolUse | Reminds the agent to format after edits |
| `block-force-push`      | PreToolUse  | Blocks `git push --force` / `-f`        |
| `require-tests-on-stop` | Stop        | Reminds to verify after mutations       |
| `protect-env-files`     | PreToolUse  | Warns when tools touch `.env`           |
| `log-bash-commands`     | PreToolUse  | Logs bash commands for audit            |

Custom hooks:

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "bash",
      "command": "echo running bash",
      "blockOnFailure": false
    }
  ]
}
```

Environment variables available to hook commands:

- `HOOK_EVENT` — PreToolUse | PostToolUse | Stop | UserPromptSubmit | PreCompact | SubagentStop | SessionStart | SessionEnd | PostCompact | Interrupt
- `HOOK_TOOL` — tool id
- `HOOK_SESSION_ID`
- `HOOK_ARGS_JSON` — JSON tool arguments
- `HOOK_ARGS_STDIN=1` — the complete JSON arguments are always available on stdin; `HOOK_ARGS_JSON` is empty for payloads larger than 32 KiB
- `HOOK_PACK` — pack name when applicable

> **Security note:** hook child processes inherit the full `process.env` of the AX Code process, including any API keys and secrets present in the environment. Treat hook commands as trusted code — only enable hooks and packs you have reviewed. Scoping the environment exposed to hooks is planned hardening (ADR-057 D4).

## Relationship to isolation

Hooks do **not** replace the sandbox. Use:

1. **App isolation** for portable write/network boundaries
2. **OS isolation** (the default `"auto"` backend) for kernel-enforced bash sandboxing when available
3. **Hooks** for policy side-effects and hard blocks like force-push

See [Sandbox Mode](sandbox.md) and [SECURITY.md](../../SECURITY.md).
