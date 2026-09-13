# Audio notifications

Status: Current
Scope: AX Code TUI sound and spoken alerts
Last reviewed: 2026-09-12
Owner: AX Code runtime maintainers

The TUI can play a system sound — or speak a short templated phrase — whenever AX Code needs your attention:

- **Permission request** — a tool is waiting for your approval.
- **Agent question** — the agent asked you a question.
- **Turn complete** — the run finished (off by default).
- **Session error** — the turn failed.

Audio rides the same triggers as the terminal notification (OSC 9 desktop notification, or the terminal bell where OSC 9 is unsupported) and is gated by the same `notifications.enabled` switch. It is **off by default**; enabling it changes nothing else about notifications.

## Configuration

Set `notifications.sound` in `tui.json`:

```json
{
  "notifications": {
    "enabled": true,
    "sound": "chime",
    "events": {
      "permission": true,
      "question": true,
      "complete": false,
      "error": true
    }
  }
}
```

| Field               | Values                        | Default | Meaning                                                              |
| ------------------- | ----------------------------- | ------- | -------------------------------------------------------------------- |
| `enabled`           | boolean                       | `true`  | Master gate for terminal notifications and audio.                    |
| `sound`             | `"off"`, `"chime"`, `"speak"` | `"off"` | `chime` plays a system sound; `speak` synthesizes voice.             |
| `voice`             | string                        | `""`    | Platform voice name (`say -v '?'` on macOS); empty = default.        |
| `rate`              | integer                       | `0`     | Speaking rate where supported (macOS words/min, 1–500); 0 = default. |
| `events.permission` | boolean                       | `true`  | Alert on permission requests.                                        |
| `events.question`   | boolean                       | `true`  | Alert on agent questions.                                            |
| `events.complete`   | boolean                       | `false` | Alert when a turn completes.                                         |
| `events.error`      | boolean                       | `true`  | Alert on session errors.                                             |

Invalid values are discarded field by field: a bad `sound` value reverts to `"off"` without affecting your other settings.

## Platform support

| Platform | Chime                                  | Speech                          | Requirement                                                              |
| -------- | -------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| macOS    | `afplay` (system sound)                | `say`                           | Built in.                                                                |
| Windows  | `System.Media.SoundPlayer`             | `System.Speech`                 | Built in (PowerShell).                                                   |
| Linux    | `paplay`, fallback `canberra-gtk-play` | `spd-say`, fallback `espeak-ng` | Install PulseAudio/`libcanberra` and/or `speech-dispatcher`/`espeak-ng`. |

Availability is probed at runtime. With no usable backend the audio step is skipped silently and the terminal notification remains as the fallback. Playback is serialized (one sound at a time, repeats coalesce), each event alerts at most once, and the interface never waits on playback. Headless runs (`ax-code run`) never play audio.

## What is spoken

Speech uses four fixed templates only: `Approval required: <tool>`, `Question: <first question>`, `Task complete: <session title>`, and `AX Code error`. Text is truncated and stripped of control characters. Tool arguments, file paths from payloads, model output, and error messages are never spoken — safe for shared spaces within those limits.

## Custom sounds via hooks

For full control (your own sound file, different text, extra events), wire any player through [lifecycle hooks](hooks.md) — this works with audio notifications disabled too. After opting in with `AX_CODE_TRUST_PROJECT_CONFIG=1`, create `.ax-code/hooks.json`:

```json
{
  "hooks": [
    { "event": "Stop", "command": "afplay /System/Library/Sounds/Glass.aiff" },
    { "event": "PreToolUse", "matcher": "bash|edit|write", "command": "say 'AX Code needs approval'" }
  ]
}
```

Use your platform's player (`afplay` on macOS, `paplay` on Linux, PowerShell `[System.Media]` on Windows). Hook commands are shell snippets — keep them fire-and-forget so they cannot delay the lifecycle path.

## Building an external notifier

External tools (status bars, mobile push, a desktop app) can subscribe to the server's event stream and react to `permission.asked`, `question.asked`, `session.status`, and `session.error` — see [HTTP and OpenAPI Compatibility](../sdk/http-openapi.md).
