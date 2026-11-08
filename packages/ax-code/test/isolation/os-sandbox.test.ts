import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { OsSandbox } from "../../src/isolation/os-sandbox"
import { Isolation } from "../../src/isolation"
import { tmpdir } from "../fixture/fixture"
import fs from "fs"
import os from "os"
import path from "path"

// Clear both before and after so tests asserting on the default backend/mode
// are not skewed by AX_CODE_ISOLATION_MODE / _NETWORK inherited from the parent
// shell (e.g. when running the suite from inside an ax-code session in
// full-access mode — the same hazard isolation.test.ts guards against).
const clearIsolationEnv = () => {
  delete process.env.AX_CODE_ISOLATION_MODE
  delete process.env.AX_CODE_ISOLATION_NETWORK
}

beforeEach(clearIsolationEnv)
afterEach(clearIsolationEnv)

describe("OsSandbox.resolveBackend", () => {
  test("defaults to auto", () => {
    expect(OsSandbox.resolveBackend({})).toBe("auto")
  })

  test("env overrides config", () => {
    expect(OsSandbox.resolveBackend({ configBackend: "app", envBackend: "os" })).toBe("os")
    expect(OsSandbox.resolveBackend({ configBackend: "os", envBackend: "auto" })).toBe("auto")
  })
})

describe("OsSandbox.buildBubblewrapArgs", () => {
  const input = (workspace: string) => ({
    command: "true",
    shell: "/bin/sh",
    cwd: workspace,
    workspaceRoot: workspace,
    worktree: workspace,
    network: false,
    protectedPaths: [path.join(workspace, ".git")],
  })

  test("binds host temp roots writable instead of masking them with an empty tmpfs", async () => {
    await using tmp = await tmpdir()
    const args = OsSandbox.buildBubblewrapArgs(input(tmp.path))
    const tmpRoot = OsSandbox.canonicalPath(os.tmpdir())
    // Existing temp content stays visible and writes persist, as with Seatbelt.
    const bind = args.findIndex((arg, index) => arg === "--bind" && args[index + 1] === tmpRoot)
    expect(bind).toBeGreaterThan(-1)
    expect(args[bind + 2]).toBe(tmpRoot)
    expect(args.some((arg, index) => arg === "--tmpfs" && args[index + 1] === "/tmp")).toBe(false)
    expect(args.some((arg, index) => arg === "--tmpfs" && args[index + 1] === tmpRoot)).toBe(false)
  })

  test("re-masks protected paths after the writable binds and unshares the network", async () => {
    await using tmp = await tmpdir()
    fs.mkdirSync(path.join(tmp.path, ".git"))
    const args = OsSandbox.buildBubblewrapArgs(input(tmp.path))
    const workspace = OsSandbox.canonicalPath(tmp.path)
    const git = OsSandbox.canonicalPath(path.join(tmp.path, ".git"))
    const workspaceBind = args.findIndex((arg, index) => arg === "--bind" && args[index + 1] === workspace)
    const protectedBind = args.findIndex((arg, index) => arg === "--ro-bind" && args[index + 1] === git)
    expect(workspaceBind).toBeGreaterThan(-1)
    expect(protectedBind).toBeGreaterThan(workspaceBind)
    expect(args).toContain("--unshare-net")
    expect(args.slice(-5)).toEqual(["--chdir", workspace, "/bin/sh", "-c", "true"])
  })
})

describe("OsSandbox.buildSeatbeltProfile", () => {
  test("allows workspace writes and can deny network", () => {
    const profile = OsSandbox.buildSeatbeltProfile({
      workspaceRoot: "/tmp/ws",
      worktree: "/tmp/ws",
      network: false,
      protectedPaths: ["/tmp/ws/.git", "/tmp/ws/.ax-code"],
    })
    expect(profile).toContain("(version 1)")
    expect(profile).toContain("(deny network*)")
    expect(profile).not.toContain("(allow mach*)")
    expect(profile).not.toContain("(allow ipc*)")
    // Paths are realpath'd — on macOS /tmp → /private/tmp
    const ws = OsSandbox.canonicalPath("/tmp/ws")
    expect(profile).toContain(`subpath "${ws}"`)
    expect(profile).toContain(".git")
  })

  test("allows network when enabled", () => {
    const profile = OsSandbox.buildSeatbeltProfile({
      workspaceRoot: "/Users/dev/proj",
      network: true,
    })
    expect(profile).toContain("(allow network*)")
  })

  test("includes realpath of os.tmpdir for mktemp", () => {
    const tmp = OsSandbox.canonicalPath(os.tmpdir())
    const profile = OsSandbox.buildSeatbeltProfile({
      workspaceRoot: "/proj",
      network: false,
    })
    expect(profile).toContain(`subpath "${tmp}"`)
  })
})

describe("OsSandbox.probeAvailability", () => {
  test("reports darwin seatbelt when sandbox-exec present", () => {
    if (process.platform !== "darwin") return
    const avail = OsSandbox.probeAvailability("darwin")
    // sandbox-exec exists on stock macOS
    if (avail.available) {
      expect(avail.mechanism).toBe("seatbelt")
    } else {
      expect(avail.reason).toMatch(/sandbox-exec/)
    }
  })

  test("windows is unavailable", () => {
    const avail = OsSandbox.probeAvailability("win32")
    expect(avail.available).toBe(false)
  })
})

describe("OsSandbox.wrapCommand", () => {
  test("on macOS produces sandbox-exec wrap when available", () => {
    if (process.platform !== "darwin") return
    const wrap = OsSandbox.wrapCommand({
      command: "echo hi",
      shell: "/bin/bash",
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      network: false,
    })
    if (!wrap.active) {
      expect(wrap.reason).toBeTruthy()
      return
    }
    expect(wrap.mechanism).toBe("seatbelt")
    expect(wrap.file).toMatch(/sandbox-exec/)
    expect(wrap.args).toContain("-f")
    expect(wrap.profilePath).toBeTruthy()
    if (wrap.profilePath && fs.existsSync(wrap.profilePath)) {
      const body = fs.readFileSync(wrap.profilePath, "utf8")
      expect(body).toContain("(deny network*)")
      OsSandbox.cleanupProfile(wrap.profilePath)
    }
  })
})

describe("Isolation.shouldUseOsSandbox", () => {
  test("false for app backend and full-access", () => {
    const app = Isolation.resolve({ mode: "workspace-write", backend: "app" }, os.tmpdir())
    expect(Isolation.shouldUseOsSandbox(app)).toBe(false)
    const full = Isolation.resolve({ mode: "full-access", backend: "os" }, os.tmpdir())
    expect(Isolation.shouldUseOsSandbox(full)).toBe(false)
  })

  test("true for os and auto backends", async () => {
    await using tmp = await tmpdir()
    const osBackend = Isolation.resolve({ mode: "workspace-write", backend: "os" }, tmp.path)
    expect(osBackend.backend).toBe("os")
    expect(Isolation.shouldUseOsSandbox(osBackend)).toBe(true)
    const auto = Isolation.resolve({ mode: "workspace-write", backend: "auto" }, tmp.path)
    expect(auto.backend).toBe("auto")
    expect(Isolation.shouldUseOsSandbox(auto)).toBe(true)
  })

  test("partial config without backend defaults to auto", () => {
    // Isolation routes and project config updates often set { mode, network }
    // without backend. That remains valid and uses OS isolation when available.
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, os.tmpdir())
    expect(state.backend).toBe("auto")
    expect(Isolation.shouldUseOsSandbox(state)).toBe(true)
    // Explicit missing backend on a partial state is treated as auto.
    expect(
      Isolation.shouldUseOsSandbox({
        mode: "workspace-write",
        network: false,
        protected: [],
      }),
    ).toBe(true)
  })
})
