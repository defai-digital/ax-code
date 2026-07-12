import { describe, expect, test } from "vitest"
import { OsSandbox } from "../../src/isolation/os-sandbox"
import { Isolation } from "../../src/isolation"
import fs from "fs"
import os from "os"
import path from "path"

describe("OsSandbox.resolveBackend", () => {
  test("defaults to app", () => {
    expect(OsSandbox.resolveBackend({})).toBe("app")
  })

  test("env overrides config", () => {
    expect(OsSandbox.resolveBackend({ configBackend: "app", envBackend: "os" })).toBe("os")
    expect(OsSandbox.resolveBackend({ configBackend: "os", envBackend: "auto" })).toBe("auto")
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

  test("true for os and auto backends", () => {
    const osBackend = Isolation.resolve({ mode: "workspace-write", backend: "os" }, os.tmpdir())
    expect(osBackend.backend).toBe("os")
    expect(Isolation.shouldUseOsSandbox(osBackend)).toBe(true)
    const auto = Isolation.resolve({ mode: "workspace-write", backend: "auto" }, path.join(os.tmpdir(), "x"))
    expect(Isolation.shouldUseOsSandbox(auto)).toBe(true)
  })

  test("partial config without backend defaults to app (routes write mode/network only)", () => {
    // Isolation routes and project config updates often set { mode, network }
    // without backend. That must remain valid and resolve to portable app-layer.
    const state = Isolation.resolve({ mode: "workspace-write", network: false }, os.tmpdir())
    expect(state.backend).toBe("app")
    expect(Isolation.shouldUseOsSandbox(state)).toBe(false)
    // Explicit missing backend on a partial state is treated as app.
    expect(
      Isolation.shouldUseOsSandbox({
        mode: "workspace-write",
        network: false,
        protected: [],
      }),
    ).toBe(false)
  })
})
