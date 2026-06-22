import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createServerUtilsRuntime } from "./server-utils-runtime.js"

const originalPath = process.env.PATH

afterEach(() => {
  if (originalPath === undefined) {
    delete process.env.PATH
    return
  }

  process.env.PATH = originalPath
})

const createRuntime = (loginShellPath) =>
  createServerUtilsRuntime({
    fs: {},
    os,
    path,
    process,
    axCodeReadyGraceMs: 0,
    longRequestTimeoutMs: 0,
    getRuntime: () => ({}),
    getAxCodeAuthHeaders: () => ({}),
    buildAxCodeUrl: (route) => route,
    ensureAxCodeApiPrefix: () => {},
    getUiNotificationClients: () => new Set(),
    getAxCodePort: () => null,
    setAxCodePortState: () => {},
    syncToHmrState: () => {},
    markAxCodeNotReady: () => {},
    setAxCodeNotReadySince: () => {},
    clearLastAxCodeError: () => {},
    getLoginShellPath: () => loginShellPath,
  })

describe("server utils runtime", () => {
  it("prefers shell PATH for managed ax-code before appending process-only entries", () => {
    const home = os.homedir()
    const currentPath = [
      path.join(home, ".ax-code", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, "Library", "pnpm"),
      "/opt/homebrew/bin",
      "/usr/bin",
    ].join(path.delimiter)
    process.env.PATH = currentPath

    const runtime = createRuntime(
      [
        path.join(home, ".ax-code", "bin"),
        path.join(home, ".bun", "bin"),
        "/opt/homebrew/bin",
        "/usr/bin",
        path.join(home, ".cargo", "bin"),
      ].join(path.delimiter),
    )

    expect(runtime.buildManagedAxCodePath()).toBe(
      [
        path.join(home, ".ax-code", "bin"),
        path.join(home, ".bun", "bin"),
        "/opt/homebrew/bin",
        "/usr/bin",
        path.join(home, ".cargo", "bin"),
        path.join(home, "Library", "pnpm"),
      ].join(path.delimiter),
    )
  })

  it("uses login shell PATH for managed ax-code when process PATH is minimal", () => {
    const home = os.homedir()
    const loginShellPath = [
      path.join(home, ".ax-code", "bin"),
      path.join(home, ".bun", "bin"),
      "/opt/homebrew/bin",
      "/usr/bin",
    ].join(path.delimiter)
    process.env.PATH = ["/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter)

    const runtime = createRuntime(loginShellPath)

    // Should prefer login shell PATH but merge in any process entries not already present.
    expect(runtime.buildManagedAxCodePath()).toBe(
      [
        path.join(home, ".ax-code", "bin"),
        path.join(home, ".bun", "bin"),
        "/opt/homebrew/bin",
        "/usr/bin",
        "/usr/local/bin",
        "/bin",
      ].join(path.delimiter),
    )
  })

  it("preserves user-configured process PATH order before appending shell-only entries", () => {
    const home = os.homedir()
    process.env.PATH = [
      path.join(home, ".bun", "bin"),
      path.join(home, "Library", "pnpm"),
      "/opt/homebrew/bin",
      "/usr/bin",
    ].join(path.delimiter)

    const runtime = createRuntime(
      [path.join(home, ".bun", "bin"), "/opt/homebrew/bin", path.join(home, ".cargo", "bin"), "/usr/bin"].join(
        path.delimiter,
      ),
    )

    expect(runtime.buildAugmentedPath()).toBe(
      [
        path.join(home, ".bun", "bin"),
        path.join(home, "Library", "pnpm"),
        "/opt/homebrew/bin",
        "/usr/bin",
        path.join(home, ".cargo", "bin"),
      ].join(path.delimiter),
    )
  })

  it("prefers login shell PATH when current process PATH is minimal", () => {
    const home = os.homedir()
    process.env.PATH = ["/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter)

    const runtime = createRuntime(
      [path.join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/bin"].join(path.delimiter),
    )

    expect(runtime.buildAugmentedPath()).toBe(
      [path.join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/bin", "/usr/local/bin", "/bin"].join(path.delimiter),
    )
  })
})
