import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ComputerUseProvider, ProbeReport } from "@ax-code/computer"
import { getComputerUseCheck } from "../../src/cli/cmd/doctor-computer"

// Computer.resolveBackend honors the AX_COMPUTER_COMMAND host env override and
// discovers the ax-computer server on PATH; the command assertions below would
// fail on a machine that has either. Pin them away (PATH points at a directory
// without ax-computer) so the check output is host-independent.
beforeEach(() => {
  vi.stubEnv("AX_COMPUTER_COMMAND", undefined)
  vi.stubEnv("PATH", "/nonexistent-test-path")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function probeReturning(report: Partial<ProbeReport>) {
  return vi.fn(
    async (_provider: ComputerUseProvider): Promise<ProbeReport> => ({
      ok: true,
      provider: "fake",
      latencyMs: 12,
      ...report,
    }),
  )
}

describe("doctor computer use check", () => {
  test("not configured → ok with enablement hint", async () => {
    const check = await getComputerUseCheck({ config: undefined })
    expect(check).toEqual({
      name: "Computer use",
      status: "ok",
      detail: "not configured (set computer.provider to enable desktop control)",
    })
  })

  test("no server command resolvable → fail with the install hint", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({ config: { provider: "cua" }, platform: "darwin", probe })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain("requires the ax-computer server")
    expect(check.detail).toContain("AX_COMPUTER_COMMAND")
    expect(probe).not.toHaveBeenCalled()
  })

  test("probe ok → ok with command, latency, and app count", async () => {
    vi.stubEnv("AX_COMPUTER_COMMAND", process.execPath)
    const check = await getComputerUseCheck({
      config: { provider: "cua" },
      platform: "linux",
      probe: probeReturning({ ok: true, provider: "cua", latencyMs: 42, apps: 7 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toBe(
      `provider cua via ${process.execPath} mcp --backend cua — handshake ok in 42ms, 7 apps visible`,
    )
  })

  test("probe ok on darwin appends the TCC host-process reminder", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "axnative", command: "ax-computer" },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "axnative", latencyMs: 30, apps: 3 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toContain("provider axnative via ax-computer mcp --backend axnative")
    expect(check.detail).toContain("Accessibility/Screen Recording")
  })

  test("probe failure → fail with command tried, env override, and install hint", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "cua", command: "ax-computer" },
      platform: "darwin",
      probe: probeReturning({
        ok: false,
        provider: "cua",
        error: 'McpClientError: failed to spawn MCP server "ax-computer": spawn ENOENT.',
      }),
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain('"ax-computer mcp --backend cua"')
    expect(check.detail).toContain("AX_COMPUTER_COMMAND")
    expect(check.detail).toContain("Install the ax-computer server")
    expect(check.detail).toContain("spawn ENOENT")
  })

  test("config command override is reflected in the reported command", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "cua", command: process.execPath, args: ["serve"] },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "cua", latencyMs: 5, apps: 1 }),
    })
    expect(check.detail).toContain(`via ${process.execPath} serve`)
  })

  test("unexpected throw becomes a warn, never a crash", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "cua", command: "ax-computer" },
      platform: "darwin",
      probe: async () => {
        throw new Error("kaboom")
      },
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("kaboom")
  })

  test("missing server binary path fails fast, no probe spawned", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "axnative", command: "/nonexistent/ax-computer" },
      platform: "darwin",
      probe,
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain("/nonexistent/ax-computer")
    expect(check.detail).toContain("ax-computer server")
    expect(probe).not.toHaveBeenCalled()
  })

  test("axnative on non-darwin → warn, no probe spawned", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "axnative", command: "ax-computer" },
      platform: "linux",
      probe,
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("macOS-only")
    expect(probe).not.toHaveBeenCalled()
  })

  test("external with a missing binary path fails fast, no probe spawned", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "external", command: "/nonexistent/ax-computer-server" },
      platform: "darwin",
      probe,
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain("/nonexistent/ax-computer-server")
    expect(check.detail).toContain("AX_COMPUTER_COMMAND")
    expect(probe).not.toHaveBeenCalled()
  })

  test("external probe ok → ok with command and latency", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "external", command: process.execPath },
      platform: "linux",
      probe: probeReturning({ ok: true, provider: "external", latencyMs: 21, apps: 4 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toContain(`provider external via ${process.execPath}`)
    expect(check.detail).toContain("4 apps visible")
  })

  test("external protocol incompatibility surfaces as a doctor failure", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "external", command: "ax-computer-server" },
      platform: "darwin",
      probe: probeReturning({
        ok: false,
        provider: "external",
        error:
          "ProtocolError: AX Computer protocol version mismatch: this client speaks versions 1..1, but the server speaks 99..99.",
      }),
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain('"ax-computer-server"')
    expect(check.detail).toContain("AX_COMPUTER_COMMAND")
    expect(check.detail).toContain("protocol version mismatch")
  })
})
