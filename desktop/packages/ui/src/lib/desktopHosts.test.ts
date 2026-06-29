import { afterEach, describe, expect, test } from "vitest"
import { desktopHostProbe, desktopHostsGet, isBlockingHostProbeStatus, normalizeHostUrl } from "./desktopHosts"

type MockDesktopWindowOptions = {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

const restoreWindow = () => {
  delete (globalThis as Record<string, unknown>).window
}

const mockDesktopWindow = (options: MockDesktopWindowOptions = {}) => {
  ;(globalThis as Record<string, unknown>).window = {
    location: { origin: "https://remote.example.com" },
    __AX_CODE_DESKTOP_ELECTRON__: { runtime: "electron" },
    __TAURI__: {
      core: { invoke: options.invoke ?? (async () => null) },
    },
  }
}

afterEach(() => {
  restoreWindow()
})

describe("normalizeHostUrl", () => {
  test("strips credentials, query, and hash before renderer state can use the host URL", () => {
    expect(normalizeHostUrl(" https://user:pass@remote.example.com/app?token=secret#frag ")).toBe(
      "https://remote.example.com/app",
    )
  })
})

describe("desktopHostsGet", () => {
  test("captures the Electron local origin from the desktop hosts IPC response", async () => {
    const invokedCommands: string[] = []
    mockDesktopWindow({
      invoke: async (command) => {
        invokedCommands.push(command)
        return {
          hosts: [{ id: "remote-a", label: "Remote A", url: "https://remote.example.com/" }],
          defaultHostId: "remote-a",
          initialHostChoiceCompleted: true,
          localOrigin: "http://localhost:3910",
        }
      },
    })

    const result = await desktopHostsGet()

    expect(invokedCommands).toEqual(["desktop_hosts_get"])
    expect(result).toEqual({
      hosts: [{ id: "remote-a", label: "Remote A", url: "https://remote.example.com/" }],
      defaultHostId: "remote-a",
      initialHostChoiceCompleted: true,
      localOrigin: "http://localhost:3910",
    })
    expect(window.__AX_CODE_DESKTOP_LOCAL_ORIGIN__).toBe("http://localhost:3910")
  })
})

describe("desktopHostProbe", () => {
  test("preserves compatibility probe statuses from Electron", async () => {
    const statuses = ["incompatible", "update-recommended"] as const

    for (const status of statuses) {
      mockDesktopWindow({
        invoke: async (command) => {
          expect(command).toBe("desktop_host_probe")
          return { status, latencyMs: 42 }
        },
      })

      await expect(desktopHostProbe("https://remote.example.com")).resolves.toEqual({ status, latencyMs: 42 })
      restoreWindow()
    }
  })

  test("treats compatibility failures as blocking host probe statuses", () => {
    expect(isBlockingHostProbeStatus("ok")).toBe(false)
    expect(isBlockingHostProbeStatus("auth")).toBe(false)
    expect(isBlockingHostProbeStatus("wrong-service")).toBe(true)
    expect(isBlockingHostProbeStatus("unreachable")).toBe(true)
    expect(isBlockingHostProbeStatus("incompatible")).toBe(true)
    expect(isBlockingHostProbeStatus("update-recommended")).toBe(true)
    expect(isBlockingHostProbeStatus(null)).toBe(false)
  })
})
