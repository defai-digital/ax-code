# Conversation recap

Status: Current
Scope: AX Code TUI conversation recaps
Last reviewed: 2026-09-07
Owner: AX Code runtime maintainers

Use `/recap` in an idle TUI session to catch up on the recent conversation, including after resuming a saved session. AX Code summarizes up to eight recent user turns in a short banner: the objective, confirmed progress, verification, and the next step or blocker. The banner disappears when you type, start another turn, or change sessions.

The recap uses a model and can be incomplete or inaccurate. It favors the latest request and outcomes when a conversation exceeds its input budget. Check the transcript for exact results. Recaps do not modify the transcript, run tools, or change task status.

AX Code also generates a recap of the latest turn after five seconds of idle time following a completed turn. Configure automatic display in `tui.json`:

```json
{
  "idle_recap": {
    "enabled": true,
    "delay_ms": 5000
  }
}
```

Set `enabled` to `false` to disable automatic recaps. `/recap` remains available. Generation uses the recap agent's configured model when available, then the provider's small model, then the session model. Recaps make a separate model request and may consume provider quota. Failed or unfinished turns and managed AX Engine sessions do not generate recaps. Manual requests show a notice when no recap is available; automatic failures stay silent. Use `/recap` to retry explicitly.

`/compact` summarizes older history for the model to free context. `/summarize` remains its alias. Use `/recap` for a catch-up banner and `/compact` when you need context compression.
