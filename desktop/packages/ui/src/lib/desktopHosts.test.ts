import { afterEach, describe, expect, test } from "vitest"
import { desktopHostsGet } from "./desktopHosts"

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
