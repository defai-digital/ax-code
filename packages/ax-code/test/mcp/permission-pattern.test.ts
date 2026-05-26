import { describe, expect, test } from "bun:test"
import path from "node:path"
import { McpPermissionPattern } from "../../src/mcp/permission-pattern"

describe("McpPermissionPattern.derive", () => {
  test("derives durable URL and repo patterns", () => {
    const result = McpPermissionPattern.derive("github_search", {
      url: "https://api.github.com/repos/owner/repo#secret",
      owner: "owner",
      repo: "repo",
    })

    expect(result.patterns).toContain("url:https://api.github.com/repos/owner/repo")
    expect(result.patterns).toContain("repo:owner/repo")
    expect(result.always).toEqual(result.patterns)
    expect(result.durable).toBe(true)
  })

  test("normalizes worktree-local paths as durable relative patterns", () => {
    const worktree = path.join(path.sep, "tmp", "repo")
    const result = McpPermissionPattern.derive("fs_read", { filePath: path.join(worktree, "src", "index.ts") }, { worktree })

    expect(result.patterns).toEqual(["path:src/index.ts"])
    expect(result.always).toEqual(["path:src/index.ts"])
    expect(result.durable).toBe(true)
  })

  test("redacts external paths and disables durable approval", () => {
    const worktree = path.join(path.sep, "tmp", "repo")
    const result = McpPermissionPattern.derive("fs_read", { path: path.join(path.sep, "etc", "passwd") }, { worktree })

    expect(result.patterns).toEqual(["path:<external>"])
    expect(result.always).toEqual([])
    expect(result.durable).toBe(false)
  })

  test("falls back to non-durable wildcard for unknown args and redacts secrets in metadata", () => {
    const result = McpPermissionPattern.derive("custom_tool", {
      query: "hello",
      apiToken: "secret",
    })

    expect(result.patterns).toEqual(["*"])
    expect(result.always).toEqual([])
    expect(result.metadata.args).toMatchObject({ query: "hello", apiToken: "[redacted]" })
  })
})
