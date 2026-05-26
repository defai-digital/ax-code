# MCP Integrations

Status: Active
Scope: current-state
Last reviewed: 2026-05-26
Owner: ax-code runtime

AX Code can connect to Model Context Protocol servers for external tools, prompts, and resources. MCP is powerful, so AX Code treats MCP configuration and MCP-provided content as a trust boundary.

## Trust Model

MCP entries from user-controlled config sources are trusted by default:

- global user config;
- managed config;
- explicit `AX_CODE_CONFIG`;
- inline `AX_CODE_CONFIG_CONTENT`;
- runtime additions through authorized local runtime routes.

MCP entries from shared or network-discovered sources are not trusted by default:

- project `ax-code.json`;
- worktree `.ax-code` config;
- remote well-known config.

Untrusted MCP entries show as `needs_trust`. AX Code does not spawn local MCP commands, connect remote MCP URLs, expose MCP tool schemas, list prompts/resources, or start OAuth for that entry until it is trusted.

## Trust Commands

List MCP status:

```bash
ax-code mcp list
```

Trust one server fingerprint:

```bash
ax-code mcp trust <name>
```

Revoke trust for the current server fingerprint:

```bash
ax-code mcp untrust <name>
```

Trust is stored outside the repository and is scoped to the current project plus the server fingerprint. Changing material MCP config, such as command, URL, OAuth mode, headers, or explicit environment values, invalidates previous trust.

## Runtime Permissions

Trust only allows the MCP server to participate in the runtime. Individual MCP tool calls still go through AX Code permissions.

MCP tool permission keys keep the existing `<server>_<tool>` shape. When AX Code can identify a stable resource from tool arguments, it asks with a narrower pattern, such as:

- `url:https://api.example.com/resource`
- `uri:mcp-resource`
- `path:src/index.ts`
- `repo:owner/name`
- `db:database.table`

Unknown argument shapes ask without offering broad durable approval by default.

## Prompts, Resources, And Content

MCP prompts and resources are untrusted context. AX Code gates MCP prompt use and MCP resource reads through permissions, labels fetched text as untrusted MCP content, and truncates large text before it enters the model context.

MCP tool metadata and outputs are also bounded:

- oversized schemas are rejected before tool exposure;
- long descriptions are capped;
- local MCP stderr logs are shortened and obvious secret patterns are redacted;
- model-facing MCP tool content uses the same truncation result as the user-visible tool output.

## Server Mode

Mutating MCP HTTP routes require a process-local runtime authorization header in addition to general server protections. This protects local runtime-control actions such as adding, connecting, disconnecting, and authenticating MCP servers. Read-only MCP status remains available through `GET /mcp`.
