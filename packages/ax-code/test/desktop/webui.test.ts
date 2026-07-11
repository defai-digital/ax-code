import path from "path"
import { describe, expect, test } from "vitest"
import { __internal, resolveDesktopInvocation } from "../../src/desktop/webui"

const appPath = "/Applications/AX Code.app"
const executable = path.join(appPath, "Contents", "MacOS", "AX Code")
const resources = path.join(appPath, "Contents", "Resources")
const cli = path.join(resources, "app.asar", "dist", "desktop-cli.mjs")
const server = path.join(resources, "app.asar", "dist", "server.js")
const webDist = path.join(resources, "web-dist")

describe("desktop web UI invocation", () => {
  test("discovers the packaged macOS app runtime when no shim is on PATH (#355)", () => {
    const existing = new Set([appPath, executable, cli, server, webDist])
    const invocation = resolveDesktopInvocation("/tmp/project", {
      platform: "darwin",
      env: {},
      homeDir: "/Users/test",
      existsSync: (candidate) => existing.has(candidate),
      findOnPath: () => null,
    })

    expect(invocation).toEqual({
      command: executable,
      args: [cli],
      displayName: "AX Code.app web runtime",
      installedAppPath: appPath,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        AX_CODE_DESKTOP_SERVER_PATH: server,
        AX_CODE_DESKTOP_DIST_DIR: webDist,
      },
    })
  })

  test("keeps a PATH runtime ahead of the app bundle", () => {
    const invocation = resolveDesktopInvocation("/tmp/project", {
      platform: "darwin",
      env: {},
      existsSync: () => true,
      findOnPath: () => "/opt/homebrew/bin/ax-code-desktop",
    })

    expect(invocation.command).toBe("/opt/homebrew/bin/ax-code-desktop")
    expect(invocation.args).toEqual([])
  })

  test("distinguishes an installed legacy app from a missing Desktop install", () => {
    const invocation = resolveDesktopInvocation("/tmp/project", {
      platform: "darwin",
      env: {},
      homeDir: "/Users/test",
      existsSync: (candidate) => candidate === appPath,
      findOnPath: () => null,
    })
    const error = Object.assign(new Error("spawn failed"), { code: "ENOENT" })

    expect(__internal.desktopCommandError(invocation, error).message).toContain(
      "AX Code Desktop is installed at /Applications/AX Code.app",
    )
    expect(__internal.desktopCommandError(invocation, error).message).toContain("Upgrade AX Code Desktop")
  })

  test("reports a genuinely missing app and runtime clearly", () => {
    const invocation = resolveDesktopInvocation("/tmp/project", {
      platform: "darwin",
      env: {},
      homeDir: "/Users/test",
      existsSync: () => false,
      findOnPath: () => null,
    })
    const error = Object.assign(new Error("spawn failed"), { code: "ENOENT" })

    expect(__internal.desktopCommandError(invocation, error).message).toContain("Desktop is not installed")
    expect(__internal.desktopCommandError(invocation, error).message).toContain("no ax-code-desktop runtime is on PATH")
  })
})
