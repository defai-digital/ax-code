import { describe, expect, test } from "vitest"
import {
  checkForDesktopUpdates,
  downloadDesktopUpdate,
  openDesktopFileInApp,
  requestDirectoryAccess,
  revealDesktopPath,
  restartToApplyUpdate,
} from "./desktop"

const restoreWindow = () => {
  delete (globalThis as Record<string, unknown>).window
}

type MockDesktopWindowOptions = {
  dialogOpen?: (options: Record<string, unknown>) => Promise<unknown>
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  listen?: (event: string, handler: (evt: { payload?: unknown }) => void) => Promise<() => void>
  exposeTauri?: boolean
}

const mockDesktopWindow = (options: MockDesktopWindowOptions = {}) => {
  const exposeTauri = options.exposeTauri ?? true
  ;(globalThis as Record<string, unknown>).window = {
    location: { origin: "http://localhost:5173" },
    __AX_CODE_DESKTOP_ELECTRON__: { runtime: "electron" },
    ...(exposeTauri
      ? {
          __TAURI__: {
            core: { invoke: options.invoke ?? (async () => null) },
            dialog: { open: options.dialogOpen ?? (async () => null) },
            event: options.listen ? { listen: options.listen } : undefined,
          },
        }
      : {}),
  }
}

describe("requestDirectoryAccess", () => {
  test("uses the desktop dialog bridge for local Electron directory selection", async () => {
    const calls: Record<string, unknown>[] = []
    mockDesktopWindow({
      dialogOpen: async (options) => {
        calls.push(options)
        return "/Users/test/project"
      },
    })

    const result = await requestDirectoryAccess("/Users/test")
    expect(result).toEqual({
      success: true,
      path: "/Users/test/project",
    })
    expect(calls).toEqual([
      {
        directory: true,
        multiple: false,
        title: "Select Working Directory",
      },
    ])
    restoreWindow()
  })

  test("reports cancellation when the desktop dialog returns no path", async () => {
    mockDesktopWindow({ dialogOpen: async () => null })

    const result = await requestDirectoryAccess("/Users/test")
    expect(result).toEqual({
      success: false,
      error: "Directory selection cancelled",
    })
    restoreWindow()
  })
})

describe("desktop open file in app IPC", () => {
  test("routes file open requests through the Electron desktop bridge", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    mockDesktopWindow({
      invoke: async (command, args) => {
        calls.push({ command, args })
        return null
      },
    })

    expect(await openDesktopFileInApp("/Users/test/project/README.md", "vscode", "Visual Studio Code")).toBe(true)
    expect(calls).toEqual([
      {
        command: "desktop_open_file_in_app",
        args: {
          filePath: "/Users/test/project/README.md",
          appId: "vscode",
          appName: "Visual Studio Code",
        },
      },
    ])
    restoreWindow()
  })
})

describe("desktop reveal path IPC", () => {
  test("routes reveal requests through the Electron desktop bridge", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    mockDesktopWindow({
      invoke: async (command, args) => {
        calls.push({ command, args })
        return null
      },
    })

    expect(await revealDesktopPath("/Users/test/project/README.md")).toBe(true)
    expect(calls).toEqual([
      {
        command: "desktop_reveal_path",
        args: {
          path: "/Users/test/project/README.md",
        },
      },
    ])
    restoreWindow()
  })
})

describe("desktop updater IPC", () => {
  test("checks for updates through the Electron desktop bridge", async () => {
    const commands: string[] = []
    mockDesktopWindow({
      invoke: async (command) => {
        commands.push(command)
        return { available: true, version: "1.1.2", currentVersion: "1.1.1" }
      },
    })

    const result = await checkForDesktopUpdates()

    expect(result).toEqual({ available: true, version: "1.1.2", currentVersion: "1.1.1" })
    expect(commands).toEqual(["desktop_check_for_updates"])
    restoreWindow()
  })

  test("does not report a desktop update check when the IPC bridge is unavailable", async () => {
    mockDesktopWindow({ exposeTauri: false })

    expect(await checkForDesktopUpdates()).toBeNull()
    restoreWindow()
  })

  test("downloads updates through the Electron desktop bridge", async () => {
    const commands: string[] = []
    mockDesktopWindow({
      invoke: async (command) => {
        commands.push(command)
        return null
      },
      listen: async (event, handler) => {
        handler({ payload: { event: "Started", data: { contentLength: 10 } } })
        expect(event).toBe("openchamber:update-progress")
        return () => {
          commands.push("unlisten")
        }
      },
    })
    const progress: Array<{ downloaded: number; total?: number }> = []

    const result = await downloadDesktopUpdate((next) => progress.push(next))

    expect(result).toBe(true)
    expect(commands).toEqual(["desktop_download_and_install_update", "unlisten"])
    expect(progress).toEqual([{ downloaded: 0, total: 10 }])
    restoreWindow()
  })

  test("applies Electron updates through quit-and-install", async () => {
    const commands: string[] = []
    mockDesktopWindow({
      invoke: async (command) => {
        commands.push(command)
        return null
      },
    })

    expect(await restartToApplyUpdate()).toBe(true)
    expect(commands).toEqual(["desktop_quit_and_install"])
    restoreWindow()
  })
})
