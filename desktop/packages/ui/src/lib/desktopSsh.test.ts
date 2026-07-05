import { afterEach, describe, expect, test, vi } from "vitest"
import { createDesktopSshInstance, desktopSshInstancesGet, desktopSshLogs, normalizeDesktopSshBindHost } from "./desktopSsh"

describe("desktopSsh", () => {
  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  })

  test("uses npm as the default managed install method", () => {
    const instance = createDesktopSshInstance("remote-1", "ssh example.com")

    expect(instance.remoteOpenchamber.installMethod).toBe("npm")
  })

  test("preserves valid loopback bind aliases and rejects unsafe bind hosts", () => {
    expect(normalizeDesktopSshBindHost("127.0.0.2")).toBe("127.0.0.2")
    expect(normalizeDesktopSshBindHost("127.10.20.30")).toBe("127.10.20.30")
    expect(normalizeDesktopSshBindHost("localhost")).toBe("localhost")
    expect(normalizeDesktopSshBindHost("0.0.0.0")).toBe("0.0.0.0")
    expect(normalizeDesktopSshBindHost("127.0.0.999")).toBe("127.0.0.1")
    expect(normalizeDesktopSshBindHost("192.168.1.10")).toBe("127.0.0.1")
  })

  test("normalizes legacy bun install method to npm", async () => {
    const invoke = vi.fn().mockResolvedValue({
      instances: [
        {
          id: "remote-1",
          sshCommand: "ssh example.com",
          remoteOpenchamber: {
            mode: "managed",
            installMethod: "bun",
          },
        },
      ],
    })
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
    }

    await expect(desktopSshInstancesGet()).resolves.toEqual({
      instances: [
        expect.objectContaining({
          id: "remote-1",
          remoteOpenchamber: expect.objectContaining({
            installMethod: "npm",
          }),
        }),
      ],
    })
  })

  test("preserves legacy snake-case parsed ssh command metadata", async () => {
    const invoke = vi.fn().mockResolvedValue({
      instances: [
        {
          id: "remote-1",
          ssh_command: "ssh -p 2222 alice@example.com",
          ssh_parsed: {
            destination: "alice@example.com",
            args: ["-p", "2222", "alice@example.com"],
          },
        },
      ],
    })
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
    }

    await expect(desktopSshInstancesGet()).resolves.toEqual({
      instances: [
        expect.objectContaining({
          id: "remote-1",
          sshCommand: "ssh -p 2222 alice@example.com",
          sshParsed: {
            destination: "alice@example.com",
            args: ["-p", "2222", "alice@example.com"],
          },
        }),
      ],
    })
  })

  test("preserves a stored main tunnel loopback bind alias", async () => {
    const invoke = vi.fn().mockResolvedValue({
      instances: [
        {
          id: "remote-1",
          sshCommand: "ssh example.com",
          localForward: {
            bindHost: "127.10.20.30",
          },
        },
      ],
    })
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
    }

    await expect(desktopSshInstancesGet()).resolves.toEqual({
      instances: [
        expect.objectContaining({
          id: "remote-1",
          localForward: expect.objectContaining({
            bindHost: "127.10.20.30",
          }),
        }),
      ],
    })
  })

  test("filters non-string desktop ssh log entries", async () => {
    const invoke = vi.fn().mockResolvedValue(["connected", null, "ready", 42])
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
    }

    await expect(desktopSshLogs("remote-1", 25)).resolves.toEqual(["connected", "ready"])
    expect(invoke).toHaveBeenCalledWith("desktop_ssh_logs", { id: "remote-1", limit: 25 })
  })
})
