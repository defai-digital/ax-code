import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Isolation } from "../../src/isolation"

const root = "/tmp/project"
const worktree = "/tmp/worktree"

afterEach(() => {
  delete process.env.AX_CODE_ISOLATION_MODE
  delete process.env.AX_CODE_ISOLATION_NETWORK
})

describe("isolation.resolve", () => {
  test("defaults to workspace-write with network disabled", () => {
    const state = Isolation.resolve(undefined, root)
    expect(state.mode).toBe("workspace-write")
    expect(state.network).toBe(false)
    expect(state.protected).toContain(path.resolve(root, ".git"))
    expect(state.protected).toContain(path.resolve(root, ".ax-code"))
  })

  test("applies config protected paths", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false, protected: ["secrets"] }, root)
    expect(state.protected).toContain(path.resolve(root, "secrets"))
  })

  test("env flags override config", () => {
    process.env.AX_CODE_ISOLATION_MODE = "read-only"
    process.env.AX_CODE_ISOLATION_NETWORK = "true"
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(state.mode).toBe("read-only")
    expect(state.network).toBe(true)
  })

  test("full-access always enables network", () => {
    const state = Isolation.resolve({ mode: "full-access", network: false }, root)
    expect(state.mode).toBe("full-access")
    expect(state.network).toBe(true)
  })
})

describe("isolation.assertWrite", () => {
  test("allows writes in workspace-write mode inside directory and worktree", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertWrite(state, path.join(root, "src/index.ts"), root, worktree)).not.toThrow()
    expect(() => Isolation.assertWrite(state, path.join(worktree, "src/index.ts"), root, worktree)).not.toThrow()
  })

  test("denies writes in read-only mode", () => {
    const state = Isolation.resolve({ mode: "read-only", network: false }, root)
    expect(() => Isolation.assertWrite(state, path.join(root, "src/index.ts"), root, worktree)).toThrow(
      "Isolation mode is read-only",
    )
  })

  test("denies writes to protected paths", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertWrite(state, path.join(root, ".git/config"), root, worktree)).toThrow(
      "Path is protected by isolation policy",
    )
  })

  test("denies writes outside workspace boundary", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertWrite(state, "/tmp/other/file.txt", root, worktree)).toThrow(
      "Path is outside workspace boundary",
    )
  })
})

describe("isolation.assertNetwork", () => {
  test("denies network when disabled", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertNetwork(state)).toThrow("Network access is disabled by isolation policy")
  })

  test("allows network in full-access mode", () => {
    const state = Isolation.resolve({ mode: "full-access", network: false }, root)
    expect(() => Isolation.assertNetwork(state)).not.toThrow()
  })
})

describe("isolation.assertBash", () => {
  test("allows workspace-local bash execution", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() =>
      Isolation.assertBash(
        state,
        path.join(root, "pkg"),
        root,
        worktree,
        [path.join(root, "pkg/file.txt"), path.join(worktree, "other.txt")],
      )
    ).not.toThrow()
  })

  test("denies bash in read-only mode", () => {
    const state = Isolation.resolve({ mode: "read-only", network: false }, root)
    expect(() => Isolation.assertBash(state, root, root, worktree, [])).toThrow(
      "Isolation mode is read-only. Bash commands are not allowed.",
    )
  })

  test("denies bash when cwd is outside workspace", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertBash(state, "/tmp/other", root, worktree, [])).toThrow(
      "Bash working directory is outside workspace boundary",
    )
  })

  test("denies bash when target path is protected", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertBash(state, root, root, worktree, [path.join(root, ".ax-code/config.json")])).toThrow(
      "Bash command targets protected path",
    )
  })

  test("denies bash when target path is outside workspace", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertBash(state, root, root, worktree, ["/tmp/outside.txt"])).toThrow(
      "Bash command targets path outside workspace boundary",
    )
  })
})
