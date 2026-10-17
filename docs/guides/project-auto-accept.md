# Project auto-accept

Status: Active
Scope: current-state
Last reviewed: 2026-10-16
Owner: AX Code maintainers

Project auto-accept is off by default. Enable it in your user config or in a
project-local config admitted by the existing project-config trust setting:

```json
{
  "permission": {
    "auto_accept": true
  }
}
```

This setting applies to ordinary `ask` outcomes for `edit`, `write`,
`apply_patch`, `multiedit`, and `bash`. Native write tools normally request the
shared `edit` permission. Existing allow and deny rules keep their behavior.

Run `/auto-accept` to toggle the mode for the current project's running instance.
The override is shared by its sessions, stays in memory, and disappears when the
instance is disposed or restarted. Other project instances and worktrees keep
independent overrides. The footer shows **Auto-accept on** while enabled, and each
automatic approval produces an **auto-accepted** toast for the current session.

The optional `project_auto_accept` keybind follows ordinary `tui.json`
conventions. It defaults to `none` to avoid accidental changes to approval mode:

```json
{
  "keybinds": {
    "project_auto_accept": "<leader>a"
  }
}
```

## Boundaries

Auto-accept cannot answer interactive-only requests, hook confirmations,
`external_directory`, `computer`, `mcp_sampling`, unknown permission classes, or
high/blocked SafetyPolicy risks. It does not bypass explicit deny rules,
matching managed rules, the guardian, or isolation. Protected and blocked paths
remain excluded, including policy files, credentials, `.git` control paths,
additional configured lists, outside-project paths, and symlink targets. Bash
checks include parser-resolved paths such as output redirections. Uncertain
shell expansion and wildcard paths remain ordinary prompts.

Bash auto-accept covers a short, fixed list of read-only inspection commands:
`ls`, `cat`, `head`, `tail`, `wc`, `grep`, `pwd`, and `echo`, with a small set of
known options. Recursive options (`-r`, `-R`) and `rg` are excluded: a recursive search reads
files the path check never sees, and `rg` honours `RIPGREP_CONFIG_PATH`, which can run a program. File edits are covered by the `edit`, `write`, `apply_patch`, and
`multiedit` tools. Everything else keeps the prompt, including `git` (a repository can
configure `textconv` and external diff programs, and ref updates fire hooks), filters
that can take an output file (`sort`, `uniq`, `cut`), every command that writes
(`mkdir`, `touch`, `cp`, `mv`, `tee`, redirects with `>` or `>>`), and any path that
contains a `..` segment, because the path is normalized before symlinks are inspected.

Every path operand and input redirect target must resolve inside the project
without touching protected or blocked paths. Dangling, looping, inaccessible, or
outside-project symlinks, and targets that are not regular files or directories (FIFOs,
sockets, devices), keep the normal prompt for every auto-accepted tool.
Only known literal syntax and options qualify; wrappers, interpreters, inline
code, scripts (including `pnpm test`), command substitution, and missing or
oversized command metadata keep the normal prompt. This is not a sandbox:
existing isolation and permission checks still apply.

The runtime permission taxonomy is `safe`, `risk`, and `unknown`. The `risk`
class includes ordinary edits and shell commands; SafetyPolicy separately assigns
`high` to cases requiring stronger protection. Auto-accept checks both taxonomies
without reclassifying permissions. It does not alter existing autonomous-mode
approval rules or replace guardian decisions.

Only user settings and trusted project-local settings may enable the feature;
remote, inline, agent-specific and permission-environment settings cannot opt in.
A managed config can force `permission.auto_accept: false`. That ceiling wins over
user/project settings, other managed files and the runtime toggle. A managed
`true` does not enable the mode. Disabling the runtime toggle affects subsequent
requests; it does not cancel a tool that has already been approved.

Each automatic approval logs the permission name and redacted pattern at info
level and publishes `permission.auto_accepted`. The authenticated runtime control
route is `PUT /permission/auto-accept` with `{ "enabled": true | false }`;
`GET /permission/auto-accept` reports the effective state. The toggle never writes
configuration or persistent "Always allow" grants.
