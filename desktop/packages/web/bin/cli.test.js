import { describe, expect, it } from "vitest"
import path from "path"
import { pathToFileURL } from "url"

import { isModuleCliExecution, normalizeCliEntryPath } from "./cli-entry.js"
import {
  buildTunnelServeOptions,
  parseArgs,
  resolveAvailablePort,
  resolveTunnelProviderAndMode,
  CliError,
  EXIT_CODE,
} from "./cli.js"
import {
  buildCloudflaredArgs,
  createTunnelManager,
  normalizeTunnelMode,
  normalizeTunnelProvider,
  parseCloudflareQuickTunnelUrl,
} from "./tunnel-manager.js"

describe("cli args", () => {
  it("defaults the browser UI to the less crowded product port", () => {
    expect(parseArgs([]).options.port).toBe(3100)
  })

  it("accepts legacy daemon flags as no-ops", () => {
    expect(parseArgs(["serve", "--daemon"]).removedFlagErrors).toEqual([])
    expect(parseArgs(["serve", "-d"]).removedFlagErrors).toEqual([])
  })

  it("parses tunnel subcommands and options", () => {
    const parsed = parseArgs([
      "tunnel",
      "start",
      "--provider",
      "cloudflare",
      "--mode",
      "quick",
      "--port",
      "3100",
      "--force",
    ])

    expect(parsed.command).toBe("tunnel")
    expect(parsed.tunnelAction).toBe("start")
    expect(parsed.options.provider).toBe("cloudflare")
    expect(parsed.options.mode).toBe("quick")
    expect(parsed.options.port).toBe(3100)
    expect(parsed.options.force).toBe(true)
  })

  it("keeps tunnel auto-started server output silent even in json mode", () => {
    expect(
      buildTunnelServeOptions(
        {
          json: true,
          quiet: false,
          uiPassword: "secret",
          port: 3100,
        },
        true,
      ),
    ).toMatchObject({
      json: false,
      quiet: true,
      suppressQuietOutput: true,
      suppressStartupSummary: true,
      suppressUiPasswordWarning: true,
      explicitPort: true,
      uiPassword: "secret",
      port: 3100,
    })
  })
})

describe("port selection", () => {
  it("falls back by scanning upward instead of asking the OS for a random port", async () => {
    const selected = await resolveAvailablePort(3100, false, undefined, undefined, {
      isPortAvailable: async (port) => port !== 3100,
      fetchSystemInfoFromPort: async () => null,
    })
    expect(selected).toBe(3101)
  })
})

describe("tunnel args", () => {
  it("supports only the Cloudflare quick tunnel MVP", () => {
    expect(normalizeTunnelProvider(undefined)).toBe("cloudflare")
    expect(normalizeTunnelProvider("Cloudflare")).toBe("cloudflare")
    expect(normalizeTunnelMode(undefined)).toBe("quick")
    expect(normalizeTunnelMode("Quick")).toBe("quick")
    expect(() => normalizeTunnelProvider("ngrok")).toThrow("Unsupported tunnel provider")
    expect(() => normalizeTunnelMode("managed-remote")).toThrow("Unsupported tunnel mode")
  })

  it("maps unsupported tunnel provider and mode to CLI usage errors", () => {
    expect(resolveTunnelProviderAndMode({ provider: "cloudflare", mode: "quick" })).toEqual({
      provider: "cloudflare",
      mode: "quick",
    })

    try {
      resolveTunnelProviderAndMode({ provider: "ngrok" })
      throw new Error("expected provider error")
    } catch (error) {
      expect(error).toBeInstanceOf(CliError)
      expect(error.exitCode).toBe(EXIT_CODE.USAGE_ERROR)
      expect(error.message).toContain("Unsupported tunnel provider")
    }
  })

  it("builds the cloudflared quick tunnel invocation", () => {
    expect(buildCloudflaredArgs({ mode: "quick", originUrl: "http://127.0.0.1:3100" })).toEqual([
      "tunnel",
      "--no-autoupdate",
      "--url",
      "http://127.0.0.1:3100",
    ])
  })

  it("parses Cloudflare quick tunnel URLs from logs", () => {
    expect(
      parseCloudflareQuickTunnelUrl(
        "2026-06-30 INF +--------------------------------------------------------------------------------------------+\nhttps://demo-abc.trycloudflare.com",
      ),
    ).toBe("https://demo-abc.trycloudflare.com")
    expect(parseCloudflareQuickTunnelUrl("no public URL yet")).toBeNull()
  })

  it("checks cloudflared availability before tunnel startup", () => {
    const baseDependencies = {
      getRunDir: () => "/tmp/unused-run-dir",
      getLogsDir: () => "/tmp/unused-log-dir",
      isProcessRunning: () => false,
      terminateProcessTree: async () => true,
    }

    const missing = createTunnelManager({
      ...baseDependencies,
      searchPathFor: () => null,
      processLike: { env: {} },
    })
    expect(missing.checkDependency()).toMatchObject({
      ok: false,
      dependency: "cloudflared",
      path: null,
    })

    const configuredInvalid = createTunnelManager({
      ...baseDependencies,
      searchPathFor: () => "/usr/bin/cloudflared",
      isExecutable: () => false,
      processLike: { env: { AX_CODE_DESKTOP_CLOUDFLARED_BINARY: "/missing/cloudflared" } },
    })
    expect(configuredInvalid.checkDependency()).toMatchObject({
      ok: false,
      path: null,
    })

    const configuredValid = createTunnelManager({
      ...baseDependencies,
      searchPathFor: () => null,
      isExecutable: () => true,
      processLike: { env: { AX_CODE_DESKTOP_CLOUDFLARED_BINARY: "/opt/bin/cloudflared" } },
    })
    expect(configuredValid.checkDependency()).toMatchObject({
      ok: true,
      path: "/opt/bin/cloudflared",
    })
  })
})

describe("cli entry detection", () => {
  const modulePath = "/tmp/openchamber/bin/cli.js"
  const moduleUrl = pathToFileURL(modulePath).href

  it("resolves symlinked entry paths before comparing", () => {
    const symlinkPath = "/usr/local/bin/openchamber"
    const realpath = (filePath) => {
      if (filePath === path.resolve(symlinkPath)) {
        return modulePath
      }
      return filePath
    }

    expect(isModuleCliExecution(symlinkPath, moduleUrl, realpath)).toBe(true)
  })

  it("falls back to resolved paths when realpath fails", () => {
    const realpath = () => {
      throw new Error("realpath unavailable")
    }

    expect(isModuleCliExecution(modulePath, moduleUrl, realpath)).toBe(true)
  })

  it("returns false for non-matching entry path", () => {
    expect(isModuleCliExecution("/tmp/other-cli.js", moduleUrl)).toBe(false)
  })

  it("returns false for empty entry path", () => {
    expect(isModuleCliExecution("", moduleUrl)).toBe(false)
  })

  it("returns false when module url is not provided", () => {
    expect(isModuleCliExecution(modulePath)).toBe(false)
  })

  it("accepts wrapper binary name fallback when requested", () => {
    const wrapperPath = "/home/user/.local/bin/openchamber"
    expect(isModuleCliExecution(wrapperPath, moduleUrl, undefined, "openchamber")).toBe(true)
  })

  it("normalizes direct paths when realpath fails", () => {
    const unresolvedPath = "./packages/web/bin/cli.js"
    const realpath = () => {
      throw new Error("no symlink resolution")
    }

    expect(normalizeCliEntryPath(unresolvedPath, realpath)).toBe(path.resolve(unresolvedPath))
  })
})
