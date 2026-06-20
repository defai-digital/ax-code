import { test, expect, describe } from "vitest"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import type { Config } from "../../src/config/config"

// These tests pin a load-bearing but easy-to-break contract:
//
//   1. Every MCP tool is registered into the LLM tool surface under the
//      key `<sanitizedServer>_<sanitizedTool>`. The same key is what the
//      Permission system evaluates against at runtime (the actual call
//      lives in session/prompt.ts: `ctx.ask({ permission: key, ... })`).
//
//   2. Therefore users can target MCP tools from `permission` in their
//      ax-code.json with either an exact key or a wildcard, exactly the
//      way they target built-in tools. There is no separate `mcp.allow`
//      or `mcp.deny` config — the unified Permission system IS the
//      filter.
//
// If either of these silently drifts (e.g. someone changes sanitize, or
// session/prompt.ts switches to a different key shape, or fromConfig
// stops expanding wildcards), the user-facing capability documented in
// the Mcp schema's `.describe()` quietly stops working. These tests
// fail loudly when that happens.

describe("MCP.permissionKey", () => {
  test("server and tool names without special chars are joined with _", () => {
    expect(MCP.permissionKey("github", "search_repos")).toBe("github_search_repos")
  })

  test("spaces and slashes in either name are sanitized to underscore", () => {
    expect(MCP.permissionKey("my server", "do/thing")).toBe("my_server_do_thing")
  })

  test("hyphens and existing underscores are preserved", () => {
    expect(MCP.permissionKey("my-server", "long_tool_name")).toBe("my-server_long_tool_name")
  })

  test("colons (common in MCP names) become underscores", () => {
    expect(MCP.permissionKey("ns:server", "ns:tool")).toBe("ns_server_ns_tool")
  })
})

describe("MCP tool permission lookup via Permission.fromConfig", () => {
  function rulesetFor(permission: Config.Permission) {
    return Permission.fromConfig(permission)
  }

  test("exact MCP tool key in `permission` denies that tool only", () => {
    const ruleset = rulesetFor({ github_create_issue: "deny" })
    expect(Permission.evaluate(MCP.permissionKey("github", "create_issue"), "*", ruleset).action).toBe("deny")
    expect(Permission.evaluate(MCP.permissionKey("github", "search_repos"), "*", ruleset).action).toBe("ask")
  })

  test("wildcard MCP server prefix denies every tool from that server", () => {
    const ruleset = rulesetFor({ "github_*": "deny" })
    expect(Permission.evaluate(MCP.permissionKey("github", "create_issue"), "*", ruleset).action).toBe("deny")
    expect(Permission.evaluate(MCP.permissionKey("github", "search_repos"), "*", ruleset).action).toBe("deny")
    expect(Permission.evaluate(MCP.permissionKey("linear", "create_issue"), "*", ruleset).action).toBe("ask")
  })

  test("specific allow listed after wildcard deny wins (findLast semantics)", () => {
    // Object insertion order matters: the permission schema preserves
    // original key order via __originalKeys preprocessing. The wildcard
    // sits first; the specific allow is last, so findLast picks it.
    const ruleset = rulesetFor({
      "github_*": "deny",
      github_search_repos: "allow",
    })
    expect(Permission.evaluate(MCP.permissionKey("github", "search_repos"), "*", ruleset).action).toBe("allow")
    expect(Permission.evaluate(MCP.permissionKey("github", "create_issue"), "*", ruleset).action).toBe("deny")
  })

  test("absence of a matching rule falls through to ask", () => {
    // Empty ruleset: no match → default to ask (the safe default that
    // forces the interactive confirmation in non-autonomous mode).
    expect(Permission.evaluate(MCP.permissionKey("anything", "anytool"), "*", []).action).toBe("ask")
  })
})

describe("MCP.permissionKey is the same shape session/prompt.ts uses", () => {
  // Cross-check: the runtime executes `ctx.ask({ permission: key, ... })`
  // where `key` is `sanitize(server) + "_" + sanitize(tool)`. If anyone
  // ever refactors the runtime key derivation without going through
  // MCP.permissionKey, this snapshot would still pass — but that is the
  // point at which the contract is supposed to break, so the contract
  // test alone is not enough. A reviewer must keep the runtime call site
  // routed through MCP.permissionKey. See session/prompt.ts where the
  // MCP execute wrapper is built (search for `permission: key`).
  test("matches the documented sanitize rule (alphanumeric, _, - preserved)", () => {
    const key = MCP.permissionKey("Server.Name", "tool name (v2)")
    expect(key).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})
