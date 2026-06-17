---
name: mcp
description: Help users add, configure, trust, authenticate, and troubleshoot MCP (Model Context Protocol) servers in ax-code. Use when the user asks about MCP setup, connecting external tools, OAuth flows for MCP, trust issues, or diagnosing MCP server problems.
---

# MCP Server Management

Help users manage MCP servers in ax-code. MCP servers provide external tools, prompts, and resources to the agent.

## Adding MCP Servers

### Interactive wizard (recommended)

```bash
ax-code mcp add
```

Walks through scope (project vs global), source (template, custom local, custom remote), and required env vars.

### Manual config in `ax-code.json`

**Local server** (spawns a subprocess via stdio):

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest", "--cdp-url", "http://localhost:9222"]
    }
  }
}
```

**Remote server** (HTTP-based, OAuth auto-detected by default):

```json
{
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }
}
```

**Disable OAuth** on a remote server with `"oauth": false`.

### Config scope

| Source  | Path                             | Trust                |
| ------- | -------------------------------- | -------------------- |
| Project | `ax-code.json` (repo root)       | Untrusted by default |
| Global  | `~/.config/ax-code/ax-code.json` | Trusted by default   |

## Available Templates

Run `ax-code mcp add` and choose "From template" to see pre-configured servers grouped by category:

- **Search & Web**: exa, brave-search
- **Developer Tools**: github, gitlab, sentry
- **Databases**: postgres
- **File System**: filesystem
- **Browser & Testing**: puppeteer, playwright
- **Design**: figma
- **Cloud**: vercel, cloudflare
- **Communication**: slack

## Trust Model

MCP entries from shared sources (project `ax-code.json`, worktree `.ax-code/`, remote well-known config) show as `needs_trust` until explicitly trusted. AX Code will not spawn commands, connect URLs, expose tool schemas, or start OAuth for untrusted entries.

```bash
ax-code mcp list              # see all servers and status
ax-code mcp trust <name>      # trust a server (fingerprinted to config)
ax-code mcp untrust <name>    # revoke trust
```

Changing material config (command, URL, OAuth mode, headers, env values) invalidates previous trust.

## Auto-Discovery

```bash
ax-code mcp list --discover   # detect available servers not yet configured
```

Discovery checks for locally installed MCP servers (e.g. Playwright in web projects) and suggests them.

## OAuth Authentication

Remote servers support OAuth by default. To authenticate:

```bash
ax-code mcp auth              # interactive — pick server, opens browser
ax-code mcp auth list         # check OAuth status for all remote servers
ax-code mcp logout            # revoke stored credentials
```

If a server requires pre-registered OAuth credentials (e.g. Figma's remote endpoint returns 403 on dynamic registration):

```json
{
  "mcp": {
    "figma-remote": {
      "type": "remote",
      "url": "https://mcp.figma.com/mcp",
      "oauth": {
        "clientId": "YOUR_CLIENT_ID",
        "clientSecret": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

## Runtime & Permissions

Once trusted and connected, MCP tools are automatically exposed to the agent during sessions. Each MCP tool call still goes through the **permission system** — the user approves/denies individual invocations.

Permission keys use `<server>_<tool>` shape. When AX Code can identify a stable resource from arguments, it asks with a narrower pattern:

- `url:https://api.example.com/resource`
- `uri:mcp-resource`
- `path:src/index.ts`
- `repo:owner/name`
- `db:database.table`

In the **TUI**, toggle MCP servers on/off via the MCP dialog (space bar).

## Troubleshooting

| Symptom                           | Likely cause                            | Fix                                                     |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| `needs_trust` status              | Project config entry not trusted        | `ax-code mcp trust <name>`                              |
| `needs_auth` status               | OAuth not completed                     | `ax-code mcp auth`                                      |
| `failed` status                   | Command not found or server unreachable | Check command/path, run `ax-code mcp debug`             |
| OAuth 403 on dynamic registration | Server requires pre-registered client   | Add `oauth.clientId` and `oauth.clientSecret` to config |
| Tool count warning (>30)          | Too many MCP tools degrade LLM accuracy | Remove unused servers or deny rules                     |
| Connection timeout                | Default 5s timeout too short            | Add `"timeout": 10000` to server config                 |

### Debug command

```bash
ax-code mcp debug   # test connectivity and inspect server info
```
