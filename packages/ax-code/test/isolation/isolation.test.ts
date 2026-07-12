import { afterEach, beforeEach, describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import { Isolation } from "../../src/isolation"
import { tmpdir } from "../fixture/fixture"

const root = "/tmp/project"
const worktree = "/tmp/worktree"

// Clear both before and after so a test asserting the default is not skewed by
// AX_CODE_ISOLATION_MODE / _NETWORK inherited from the parent shell (e.g. when
// running the suite from inside an ax-code session in full-access mode).
const clearIsolationEnv = () => {
  delete process.env.AX_CODE_ISOLATION_MODE
  delete process.env.AX_CODE_ISOLATION_NETWORK
}

beforeEach(clearIsolationEnv)
afterEach(clearIsolationEnv)

describe("isolation.resolve", () => {
  test("defaults to workspace-write with network disabled", () => {
    const state = Isolation.resolve(undefined, root)
    expect(state.mode).toBe("workspace-write")
    expect(state.network).toBe(false)
    expect(state.backend).toBe("app")
    expect(state.protected).toContain(path.resolve(root, ".git"))
    expect(state.protected).toContain(path.resolve(root, ".ax-code"))
  })

  test("partial config without backend still resolves to app backend", () => {
    // Routes and tests often write { mode, network } only; backend must not
    // become a required field that breaks those call sites.
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(state.backend).toBe("app")
    expect(Isolation.shouldUseOsSandbox(state)).toBe(false)
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

  test("denies writes to protected paths in the worktree root", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root, worktree)
    expect(() => Isolation.assertWrite(state, path.join(worktree, ".git/config"), root, worktree)).toThrow(
      "Path is protected by isolation policy",
    )
  })

  test("canWrite checks protected paths with the original input path", async () => {
    const src = await fs.readFile(path.join(import.meta.dirname, "../../src/isolation/index.ts"), "utf-8")
    const start = src.indexOf("export function canWrite(")
    const end = src.indexOf("export function assertWrite(", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)

    expect(body).toContain("if (isProtected(state, filepath)) return false")
    expect(body).not.toContain("if (isProtected(state, resolved)) return false")
  })

  test.skipIf(process.platform !== "darwin" && process.platform !== "win32")(
    "denies writes to a case-variant of a not-yet-existing protected path on case-insensitive filesystems",
    async () => {
      await using tmp = await tmpdir()
      const dir = path.join(tmp.path, "project")
      await fs.mkdir(dir, { recursive: true })
      // Note: .ax-code / .git intentionally do NOT exist yet — that is the
      // window in which the case-insensitive bypass used to slip through.
      const state = Isolation.resolve({ mode: "workspace-write", network: false }, dir)
      expect(() => Isolation.assertWrite(state, path.join(dir, ".AX-CODE/auth.json"), dir, dir)).toThrow(
        "Path is protected by isolation policy",
      )
      expect(() => Isolation.assertBash(state, dir, dir, dir, [path.join(dir, ".GIT/hooks/pre-commit")])).toThrow(
        "Bash command targets protected path",
      )
    },
  )

  test("denies writes outside workspace boundary", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertWrite(state, "/tmp/other/file.txt", root, worktree)).toThrow(
      "Path is outside workspace boundary",
    )
  })

  test.skipIf(process.platform === "win32")(
    "denies writes through a workspace symlink that escapes the boundary",
    async () => {
      await using tmp = await tmpdir()
      const dir = path.join(tmp.path, "project")
      const outside = path.join(tmp.path, "outside")
      await fs.mkdir(dir, { recursive: true })
      await fs.mkdir(outside, { recursive: true })
      await fs.symlink(outside, path.join(dir, "escape"))
      const state = Isolation.resolve({ mode: "workspace-write", network: false }, dir)

      expect(() => Isolation.assertWrite(state, path.join(dir, "escape", "new.txt"), dir, dir)).toThrow(
        "Path is outside workspace boundary",
      )
    },
  )
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
      Isolation.assertBash(state, path.join(root, "pkg"), root, worktree, [
        path.join(root, "pkg/file.txt"),
        path.join(worktree, "other.txt"),
      ]),
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

  test("denies bash when a workspace symlink escapes the boundary", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "project")
    const tree = path.join(tmp.path, "worktree")
    const outside = path.join(tmp.path, "outside")
    await fs.mkdir(path.join(dir, "pkg"), { recursive: true })
    await fs.mkdir(path.join(tree, ".git"), { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    await fs.symlink(outside, path.join(dir, "pkg", "link"))
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, dir, tree)
    expect(() =>
      Isolation.assertBash(state, path.join(dir, "pkg"), dir, tree, [path.join(dir, "pkg", "link")]),
    ).toThrow("Bash command targets path outside workspace boundary")
  })
})

describe("isolation.assertBashNetwork", () => {
  test("blocks network-only commands when network is disabled", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertBashNetwork(state, ["curl"])).toThrow("Network access is disabled")
    expect(() => Isolation.assertBashNetwork(state, ["echo", "wget"])).toThrow("Network access is disabled")
  })

  test("matches on the command basename, not the full path", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertBashNetwork(state, ["/usr/bin/curl"])).toThrow("Network access is disabled")
  })

  test("allows non-network commands when network is disabled", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    expect(() => Isolation.assertBashNetwork(state, ["echo", "ls", "git", "npm"])).not.toThrow()
  })

  test("allows network commands when network is enabled or full-access", () => {
    const enabled = Isolation.resolve({ mode: "workspace-write", network: true }, root)
    expect(() => Isolation.assertBashNetwork(enabled, ["curl"])).not.toThrow()
    const full = Isolation.resolve({ mode: "full-access", network: false }, root)
    expect(() => Isolation.assertBashNetwork(full, ["curl"])).not.toThrow()
  })

  test("no-op when state is undefined", () => {
    expect(() => Isolation.assertBashNetwork(undefined, ["curl"])).not.toThrow()
  })

  test("surfaces a network DeniedError so escalation can prompt", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    try {
      Isolation.assertBashNetwork(state, ["curl"])
      throw new Error("expected DeniedError")
    } catch (e) {
      expect(e).toBeInstanceOf(Isolation.DeniedError)
      expect((e as Isolation.DeniedError).reason).toBe("network")
    }
  })
})

describe("isolation.DeniedError", () => {
  test("carries the offending resolved path so callers can scope a bypass", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    try {
      Isolation.assertWrite(state, "/tmp/other/file.txt", root, worktree)
      throw new Error("expected DeniedError")
    } catch (e) {
      expect(e).toBeInstanceOf(Isolation.DeniedError)
      const err = e as Isolation.DeniedError
      expect(err.reason).toBe("write")
      expect(err.path).toBe(path.resolve("/tmp/other/file.txt"))
    }
  })
})

describe("isolation.bypass", () => {
  test("scoped per-path bypass allows the listed path but still rejects others", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    const approved = path.resolve("/tmp/approved/x.txt")
    const denied = path.resolve("/tmp/other/y.txt")
    const withBypass: Isolation.State = { ...state, bypass: [approved] }
    expect(() => Isolation.assertWrite(withBypass, approved, root, worktree)).not.toThrow()
    expect(() => Isolation.assertWrite(withBypass, denied, root, worktree)).toThrow(
      "Path is outside workspace boundary",
    )
  })

  test("bypass does not override protected paths or bash targets", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "project")
    await fs.mkdir(path.join(dir, ".git"), { recursive: true })
    await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, dir)
    const protectedPath = path.join(dir, ".git/config")
    const otherProtected = path.join(dir, ".ax-code/secret")
    const withBypass: Isolation.State = { ...state, bypass: [protectedPath] }
    expect(() => Isolation.assertWrite(withBypass, protectedPath, dir, dir)).toThrow(
      "Path is protected by isolation policy",
    )
    expect(() => Isolation.assertBash(withBypass, dir, dir, dir, [protectedPath])).toThrow(
      "Bash command targets protected path",
    )
    expect(() => Isolation.assertWrite(withBypass, otherProtected, dir, dir)).toThrow(
      "Path is protected by isolation policy",
    )
  })
})

describe("isolation worktree guard", () => {
  test("empty worktree does not widen the write boundary to the process cwd", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    const cwdFile = path.join(process.cwd(), "outside-the-workspace.ts")
    // A bogus empty worktree must not be resolved (it would resolve to cwd and
    // widen the boundary). The write must stay confined to `root`.
    expect(Isolation.canWrite(state, cwdFile, root, "")).toBe(false)
    expect(() => Isolation.assertWrite(state, cwdFile, root, "")).toThrow("outside workspace boundary")
  })

  test("undefined worktree does not throw and stays confined to directory", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    const wt = undefined as unknown as string
    expect(() => Isolation.canWrite(state, path.join(root, "src/x.ts"), root, wt)).not.toThrow()
    expect(Isolation.canWrite(state, path.join(root, "src/x.ts"), root, wt)).toBe(true)
    expect(Isolation.canWrite(state, path.join(process.cwd(), "x.ts"), root, wt)).toBe(false)
  })

  test("assertBash tolerates empty worktree without widening to cwd", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, root)
    // cwd is outside `root`; bash there must be rejected, not allowed via a
    // cwd-widened root.
    expect(() => Isolation.assertBash(state, process.cwd(), root, "", [])).toThrow("outside workspace boundary")
  })
})

describe("isolation read-only floor", () => {
  test("read-only denies writes even with an explicit bypass entry", () => {
    const state: Isolation.State = {
      ...Isolation.resolve({ mode: "read-only", network: false }, root),
      bypass: [path.join(root, "allowed.ts")],
    }
    // A per-path bypass must never override read-only.
    expect(Isolation.canWrite(state, path.join(root, "allowed.ts"), root, worktree)).toBe(false)
    expect(() => Isolation.assertWrite(state, path.join(root, "allowed.ts"), root, worktree)).toThrow(
      "Isolation mode is read-only",
    )
  })
})
