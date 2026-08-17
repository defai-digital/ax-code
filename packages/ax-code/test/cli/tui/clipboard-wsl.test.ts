import { afterEach, describe, expect, test, vi } from "vitest"

// Coverage for the WSL clipboard gap: stock WSL ships no wl-copy/xclip/xsel,
// so Clipboard.copy hard-failed there even though the Windows-side clip.exe
// is on PATH and reads clipboard text from stdin. The read path also used
// `release().includes("WSL")`, which misses WSL1 ("...-Microsoft" kernels).
// Platform/release are mocked the same way as clipboard-copy-macos.test.ts.

const clipboardState = vi.hoisted(() => ({
  release: "5.15.153.1-microsoft-standard-WSL2",
  spawnCalls: [] as { cmd: string[]; writes: string[]; ended: boolean }[],
}))

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>()
  return {
    ...actual,
    platform: () => "linux" as NodeJS.Platform,
    release: () => clipboardState.release,
  }
})

vi.mock("@/util/which", () => ({
  // Stock WSL has clip.exe (via the Windows PATH interop) but no Linux helpers.
  which: (cmd: string) => (cmd === "clip.exe" ? "/mnt/c/Windows/System32/clip.exe" : undefined),
}))

vi.mock("@/util/process", () => ({
  Process: {
    spawn: (cmd: string[]) => {
      const call = { cmd, writes: [] as string[], ended: false }
      clipboardState.spawnCalls.push(call)
      return {
        stdin: {
          write(chunk: unknown) {
            call.writes.push(String(chunk))
            return true
          },
          end() {
            call.ended = true
          },
          once() {},
          off() {},
        },
        exited: Promise.resolve(0),
        pid: 42,
        kill: () => true,
        exitCode: 0,
        signalCode: null,
      }
    },
    run: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    text: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), text: "" }),
    killProcessTree: async () => {},
  },
}))

import { Clipboard, isWsl } from "@tui/util/clipboard"

const originalTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")

function setTty(value: boolean) {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true })
}

afterEach(() => {
  if (originalTtyDescriptor) Object.defineProperty(process.stdout, "isTTY", originalTtyDescriptor)
  else delete (process.stdout as unknown as Record<string, unknown>).isTTY
  vi.restoreAllMocks()
  delete process.env["WSL_DISTRO_NAME"]
  clipboardState.release = "5.15.153.1-microsoft-standard-WSL2"
  clipboardState.spawnCalls.length = 0
})

describe("WSL Clipboard.copy", () => {
  test("pipes text to clip.exe via stdin on WSL2", async () => {
    setTty(false)
    await Clipboard.copy("hello from wsl")

    const call = clipboardState.spawnCalls.at(-1)
    expect(call?.cmd).toEqual(["clip.exe"])
    expect(call?.writes.join("")).toBe("hello from wsl")
    expect(call?.ended).toBe(true)
  })
})

describe("isWsl", () => {
  test("detects WSL2 from the kernel release", () => {
    clipboardState.release = "5.15.153.1-microsoft-standard-WSL2"
    expect(isWsl()).toBe(true)
  })

  test("detects WSL1 from the kernel release", () => {
    clipboardState.release = "4.4.0-22621-Microsoft"
    expect(isWsl()).toBe(true)
  })

  test("detects WSL via WSL_DISTRO_NAME when the release has no marker", () => {
    clipboardState.release = "6.8.0-51-generic"
    process.env["WSL_DISTRO_NAME"] = "Ubuntu"
    expect(isWsl()).toBe(true)
  })

  test("does not flag plain Linux as WSL", () => {
    clipboardState.release = "6.8.0-51-generic"
    // Hermetic even when the test suite itself runs inside WSL.
    delete process.env["WSL_DISTRO_NAME"]
    delete process.env["WSLENV"]
    expect(isWsl()).toBe(false)
  })
})
