# Lifecycle Hooks

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-12  
Owner: ax-code runtime

Lifecycle hooks let you run shell commands on agent events without rebuilding the runtime. They complement permission rules and the isolation sandbox: **hooks are deterministic side effects** (“always format”, “never force-push”), while prompts remain advisory.

## Events

| Event           | When                                                                 | Can block?                   |
| --------------- | -------------------------------------------------------------------- | ---------------------------- |
| **PreToolUse**  | Before a tool executes                                               | Yes (`blockOnFailure: true`) |
| **PostToolUse** | After a tool completes                                               | No                           |
| **Stop**        | When a session turn completes (packs may run on stop via automation) | No                           |

These names map to AX Code’s internal plugin triggers (`tool.execute.before` / `tool.execute.after`) plus session-level stop hooks.

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

- `HOOK_EVENT` — PreToolUse | PostToolUse | Stop
- `HOOK_TOOL` — tool id
- `HOOK_SESSION_ID`
- `HOOK_ARGS_JSON` — JSON tool arguments
- `HOOK_ARGS_STDIN=1` — the complete JSON arguments are always available on stdin; `HOOK_ARGS_JSON` is empty for payloads larger than 32 KiB
- `HOOK_PACK` — pack name when applicable

## Relationship to isolation

Hooks do **not** replace the sandbox. Use:

1. **App isolation** for portable write/network boundaries
2. **OS isolation** (the default `"auto"` backend) for kernel-enforced bash sandboxing when available
3. **Hooks** for policy side-effects and hard blocks like force-push

See [Sandbox Mode](sandbox.md) and [SECURITY.md](../SECURITY.md).
