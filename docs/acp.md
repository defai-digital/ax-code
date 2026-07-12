# ACP (Agent Client Protocol) happy path

Status: Active  
Scope: documented happy path for IDE hosts  
Last reviewed: 2026-07-12

AX Code exposes an ACP server so IDEs (for example Zed) can host the agent without a custom transport.

## Requirements

- Supported CLI install (`ax-code` on PATH)
- A configured provider (`ax-code providers login` or env keys)

## Start the server

```bash
# Current directory as workspace
ax-code acp

# Explicit workspace
ax-code acp --cwd /path/to/project
```

## Initialize + session + prompt (stdio)

ACP is JSON-RPC over stdio. Minimal happy path:

```bash
# One-shot style example (hosts normally keep the process open)
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' \
  | ax-code acp
```

Typical host sequence:

1. `initialize` — negotiate protocol version and agent capabilities  
2. `session/new` — create a session with `cwd` set to the project root  
3. `session/prompt` — send user text; agent runs tools and returns a stop reason  
4. `session/load` — resume a session id known to the host  

## Zed example

```json
{
  "agent_servers": {
    "AX Code": {
      "command": "ax-code",
      "args": ["acp"]
    }
  }
}
```

## What works today

| Capability | Status |
|------------|--------|
| initialize / capabilities | Supported |
| session/new | Supported |
| session/prompt | Supported (session completes before response) |
| session/load | Supported for session id + mode restore |
| Client file read/write | Supported |
| Streaming `session/update` | Partial / not full progressive stream |
| Full terminal bridge | Placeholder |

Details and limitations: `packages/ax-code/src/acp/README.md`.

## Optional interactive questions

```bash
AX_CODE_ENABLE_QUESTION_TOOL=1 ax-code acp
```

Only enable when the host UI can answer question prompts.
