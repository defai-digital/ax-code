# Conversation recap

Status: Current
Scope: AX Code TUI conversation recaps
Last reviewed: 2026-09-12
Owner: AX Code runtime maintainers

Use `/recap` in an idle TUI session to catch up on the recent conversation, including after resuming a saved session. AX Code summarizes up to eight recent user turns in a short banner: the objective, confirmed progress, verification, and the next step or blocker. The banner stays while you type and disappears when you start another turn, change sessions, or the conversation changes. `/recap` waits for the whole session tree: while goal-mode or task subagents are still running, it asks you to wait instead of summarizing incomplete work.

The recap uses a model and can be incomplete or inaccurate. It favors the latest request and outcomes when a conversation exceeds its input budget. Check the transcript for exact results. Recaps do not modify the transcript, run tools, or change task status.

AX Code also generates a recap automatically once the whole session tree has settled — the turn is complete and no subagent is still running — and the prompt has been quiet for five seconds. Typing pauses the countdown; clearing the prompt starts it again. Generation starts shortly before the delay mark (`pregenerate`, default `true`) so the banner can appear at the mark instead of one model latency after it; a pregenerated recap is discarded silently if you type before the mark. Sessions that used subagents get a conversation-scope recap; plain sessions get a recap of the latest turn. Configure automatic display in `tui.json`:

```json
{
  "idle_recap": {
    "enabled": true,
    "delay_ms": 5000,
    "pregenerate": true
  }
}
```

Set `enabled` to `false` to disable automatic recaps. `/recap` remains available. Set `pregenerate` to `false` to generate only after the full delay, which avoids a model call when you resume typing inside the window. Generation uses the recap agent's configured model when available, then the provider's small model, then the session model. Recaps make a separate model request and may consume provider quota. Failed or unfinished turns and managed AX Engine sessions do not generate recaps. Manual requests show a notice when no recap is available; automatic failures stay silent. Use `/recap` to retry explicitly.

`/compact` summarizes older history for the model to free context. `/summarize` remains its alias. Use `/recap` for a catch-up banner and `/compact` when you need context compression.
