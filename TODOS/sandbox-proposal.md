# Sandbox Proposal

Date: 2026-04-02

Goal: add a real execution sandbox to `ax-code`, keep it enabled by default, and still let advanced users explicitly disable it.

## Summary

Recommendation:

1. Add a dedicated execution sandbox layer for shell commands and file mutations.
2. Keep the current permission/approval system, but treat it as a second layer, not the sandbox itself.
3. Default new sessions to `workspace-write` sandbox mode with network disabled.
4. Let users disable the sandbox, but only through an explicit high-risk mode.
5. Reuse the current permission UI for approvals, and add a small set of sandbox presets instead of many low-level knobs in the first release.

## What Other CLIs Do

### Codex

What stands out:
- Codex separates two concepts cleanly:
  - `sandbox mode`: what the agent can technically touch
  - `approval policy`: when the agent has to stop and ask
- It exposes three clear sandbox modes:
  - `read-only`
  - `workspace-write`
  - `danger-full-access`
- It keeps network off by default in `workspace-write`.
- It also supports approval presets like `on-request`, `untrusted`, and `never`.
- It documents protected paths even inside writable roots, such as `.git` and agent config directories.

Why this is good:
- The model stays simple for users.
- “Disable the sandbox” is possible, but it is visibly dangerous and not the default.
- Sandbox and approval behavior can be tuned independently.

Key references:
- `sandbox mode` vs `approval policy`: https://developers.openai.com/codex/agent-approvals-security
- modes and presets: https://developers.openai.com/codex/agent-approvals-security
- config keys: `sandbox_mode`, `sandbox_workspace_write.network_access`, `sandbox_workspace_write.writable_roots`, `approval_policy.granular.*`: https://developers.openai.com/codex/config-reference

### Gemini CLI

What stands out:
- Gemini has both:
  - approval modes
  - a separate sandbox setting
- Approval can be tuned with:
  - `default`
  - `auto_edit`
  - `yolo`
  - `plan`
- It also has `--allowed-tools` for a narrow bypass.
- Sandboxing is disabled by default, but can be enabled with CLI flags, env vars, or settings.
- It supports multiple sandbox backends and custom project-specific sandbox definitions like `.gemini/sandbox.Dockerfile`.

Why this is useful:
- Good flexibility for power users.
- Good escape hatch for project-specific environments.

What I would not copy:
- Sandbox-off by default. That is weaker than what you want for `ax-code`.
- Too many backend choices in the first version. That will slow implementation and support.

Key references:
- approval modes and `--allowed-tools`: https://geminicli.com/docs/reference/configuration/
- sandbox config: `tools.sandbox`, `tools.sandboxAllowedPaths`, `tools.sandboxNetworkAccess`: https://geminicli.com/docs/reference/configuration/
- sandbox overview and custom Dockerfile: https://geminicli.com/docs/reference/configuration/ and https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/sandbox.md

### AX CLI

What I found:
- The public repo surfaces I checked describe tool execution, security claims, API key encryption, and server-side Grok `code_execution`, but I did not find a documented local command sandbox model comparable to Codex or Gemini.
- The README security section focuses on encryption, no telemetry, and vulnerability protections, not an OS/container sandbox.
- The features doc lists bash execution and tool execution, but does not document sandbox modes or approval presets.

Inference:
- AX CLI appears to rely more on command/tool safety controls than on a documented local execution sandbox boundary.

Why this matters:
- `ax-code` should not copy this part. You want a stronger local execution model than AX CLI currently documents.

References:
- README: https://raw.githubusercontent.com/defai-digital/ax-cli/main/README.md
- features: https://raw.githubusercontent.com/defai-digital/ax-cli/main/docs/features.md

## Current ax-code Position

What already exists:
- Tool-level permission rules in [config.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/config/config.ts#L633) and [config.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/config/config.ts#L668)
- Runtime permission requests and approval persistence in [index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/permission/index.ts#L22) and [index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/permission/index.ts#L166)
- UI support for permission prompts and auto-accept in [permission.tsx](/Users/akiralam/code/ax-code/packages/app/src/context/permission.tsx#L54) and [use-session-commands.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/use-session-commands.tsx#L386)
- The `bash` tool already parses commands and asks for permission for `bash` and `external_directory`, but then executes directly via `child_process.spawn` in [bash.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/tool/bash.ts#L153) and [bash.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/tool/bash.ts#L167)

What is missing:
- No OS-level or container-level boundary around command execution.
- No first-class sandbox mode in config.
- No “workspace-write with network off” runtime.
- No “danger-full-access” style explicit escape hatch.

Important naming issue:
- `ax-code` already uses “sandbox” to mean Git/worktree-style project sandboxes.
- If you add execution sandboxing, the config/schema names should distinguish it internally, for example:
  - `executionSandbox`
  - `exec_sandbox`
  - `runtime.sandbox`
- User-facing copy can still say “Sandbox mode”.

## Proposed Product Design

### 1. Separate sandbox mode from approval mode

Do this:
- `sandbox mode` controls technical boundaries.
- `approval mode` controls when the user must approve.

Recommended first set of sandbox modes:
- `read-only`
- `workspace-write`
- `danger-full-access`

Recommended first set of approval modes:
- `ask`
- `on-request`
- `untrusted`
- `never`

Notes:
- `danger-full-access` should disable the sandbox entirely.
- `read-only` should block file mutation and shell commands that would mutate state.
- `workspace-write` should allow writes only inside the active workspace roots.

### 2. Default to workspace-write, network off

Recommended defaults:
- sandbox mode: `workspace-write`
- approval mode: `on-request`
- network: `false`

Why:
- This matches the safety posture you want.
- It is close to Codex’s strongest mainstream default.
- It still supports normal coding flows without forcing `read-only`.

### 3. Keep disable-sandbox available, but make it explicit

Recommended disable path:
- CLI flag:
  - `--sandbox danger-full-access`
  - optional alias: `--yolo`
- Config:
  - `runtime.sandbox.mode = "danger-full-access"`
- UI:
  - a clearly labeled toggle in settings with warning copy

Requirements:
- not default
- not silent
- should show elevated-risk copy
- should be easy to detect in telemetry/logs

### 4. Protect a few paths even in workspace-write

Recommended protected paths:
- `.git`
- `.ax-code`
- config/state directories under user home for `ax-code`
- any credential or token store path

Why:
- Prevent easy corruption of repo metadata and local agent state.
- This follows Codex’s protected-root idea and is low-cost, high-value hardening.

### 5. Keep network separate from file sandboxing

Recommended behavior:
- network off by default in `workspace-write`
- enable only through explicit config or approval
- web tools like `websearch` / `webfetch` can remain permission-gated separately

Why:
- Users often want shell/file autonomy without arbitrary outbound execution.
- Network is one of the biggest prompt-injection and exfiltration surfaces.

### 6. Do not overload auto-accept to mean “sandbox disabled”

Current risk:
- `ax-code` already has “auto-accept permissions” in [permission.tsx](/Users/akiralam/code/ax-code/packages/app/src/context/permission.tsx#L61) and [use-session-commands.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/use-session-commands.tsx#L386)

Recommendation:
- Auto-accept should only affect approval prompts.
- It must not silently switch sandbox mode.

## Proposed Technical Shape

### Config

Add a new config section, for example:

```json
{
  "runtime": {
    "sandbox": {
      "mode": "workspace-write",
      "network": false,
      "writableRoots": [],
      "protectedPaths": [".git", ".ax-code"]
    },
    "approval": {
      "mode": "on-request"
    }
  }
}
```

Alternative: keep the existing top-level `permission` schema and add:

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "network": false
  }
}
```

I prefer `runtime.sandbox` because it avoids collision with existing tool permission config.

### Runtime integration

Main insertion point:
- [bash.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/tool/bash.ts#L167)

Proposed structure:
- Introduce a small sandbox runner abstraction:
  - `Sandbox.run(command, opts)`
- `BashTool` resolves permission first, then delegates to the sandbox runner.
- The sandbox runner selects a backend based on OS/config.

### Backend strategy

Pragmatic rollout:

Phase 1:
- macOS: Seatbelt profile
- Linux: bubblewrap or similar namespace-based wrapper
- Windows: prefer WSL-backed execution if available; otherwise run unsandboxed only with explicit warning/fallback

Phase 2:
- native Windows sandbox option
- additional writable roots
- better policy diagnostics

Reason:
- Codex-grade cross-platform sandboxing is real work.
- A narrow first release is much more likely to ship and be reliable.

### Approval integration

Do not replace the current permission system.

Instead:
- keep tool approvals for:
  - `bash`
  - `edit`
  - `external_directory`
  - `webfetch`
  - `websearch`
- add sandbox escalation prompts when a command needs:
  - network while network is disabled
  - writes outside allowed roots
  - execution while in `read-only`

This mirrors Codex’s “sandbox mode + approval policy” layering.

## UX Proposal

### Settings

Add a `Sandbox` section near Permissions:
- Sandbox mode:
  - `Read-only`
  - `Workspace write`
  - `Danger full access`
- Network access:
  - off by default
- Extra writable roots:
  - advanced setting only

### Session command palette

Add commands like:
- `sandbox.mode.readonly`
- `sandbox.mode.workspace`
- `sandbox.mode.disable`
- `sandbox.network.toggle`

### Copy

Recommended labels:
- `Read-only`: Can inspect, cannot mutate
- `Workspace write`: Can edit only inside this workspace
- `Danger full access`: No sandbox restrictions

Warning copy for disable:
- “Disables command sandboxing. The agent may modify files or execute commands with your user’s full access.”

## Rollout Plan

### Phase 1: schema and UX
- Add config schema for sandbox mode and approval mode
- Add settings UI
- Add command-palette controls
- Add session/status visibility for current sandbox mode

### Phase 2: runtime enforcement
- Implement sandbox runner abstraction
- Route `bash` through sandbox runner
- Block write/edit tools outside allowed roots consistently
- Add protected-path handling

### Phase 3: escalation and telemetry
- Add sandbox escalation approval prompts
- Log sandbox denials, escalations, and mode changes
- Add a debug/test command to run arbitrary commands through the sandbox

### Phase 4: polish
- improve Windows story
- add per-project override support
- add granular trusted-command presets if needed

## Recommendation

Best product direction:

1. Copy Codex’s model shape:
   - sandbox mode
   - approval policy
   - network toggle
   - explicit dangerous bypass
2. Copy Gemini’s flexibility only selectively:
   - custom writable roots later
   - custom backend hooks later
3. Do not copy AX CLI’s apparent lack of a documented local execution sandbox.

If you want the shortest path to something strong:
- ship `workspace-write` as default
- keep network off
- keep approvals
- make `danger-full-access` opt-in and noisy

That gives `ax-code` a better default safety posture than Gemini, and a much clearer local trust model than AX CLI currently documents.
