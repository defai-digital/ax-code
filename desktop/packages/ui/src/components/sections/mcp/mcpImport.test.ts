import { describe, expect, test } from "vitest"

import { parseImportedMcpSnippet } from "./mcpImport"

describe("parseImportedMcpSnippet", () => {
  test("rejects arrays and primitives as top-level MCP snippets", () => {
    expect(parseImportedMcpSnippet("[]")).toEqual({
      ok: false,
      error: "Expected a JSON object, not an array or primitive",
    })
    expect(parseImportedMcpSnippet('"server"')).toEqual({
      ok: false,
      error: "Expected a JSON object, not an array or primitive",
    })
  })

  test("normalizes a single local MCP server entry", () => {
    expect(
      parseImportedMcpSnippet(
        JSON.stringify({
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
              env: { ROOT: "/tmp" },
              disabled: true,
            },
          },
        }),
      ),
    ).toEqual({
      ok: true,
      name: "filesystem",
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
      url: "",
      environment: [{ key: "ROOT", value: "/tmp" }],
      headers: [],
      oauthEnabled: false,
      oauthClientId: "",
      oauthClientSecret: "",
      oauthScope: "",
      oauthRedirectUri: "",
      timeout: "",
      enabled: false,
    })
  })

  test("ignores array-shaped env and oauth payloads", () => {
    expect(
      parseImportedMcpSnippet(
        JSON.stringify({
          type: "remote",
          url: "https://example.com/mcp",
          env: [["TOKEN", "secret"]],
          oauth: [{ clientId: "ignored" }],
        }),
      ),
    ).toMatchObject({
      ok: true,
      type: "remote",
      url: "https://example.com/mcp",
      environment: [],
      oauthEnabled: false,
    })
  })
})
