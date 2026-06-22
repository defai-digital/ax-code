import { afterEach, describe, expect, test, vi } from "vitest"
import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { PassThrough } from "node:stream"
import { Auth } from "../../src/auth"
import {
  DEFAULT_LOGIN_PROVIDER_IDS,
  ProvidersLoginCommand,
  ProvidersListCommand,
  ProvidersLogoutCommand,
} from "../../src/cli/cmd/providers"
import { Process } from "../../src/util/process"
import { Ssrf } from "../../src/util/ssrf"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

const originalCwd = process.cwd()
const authFile = path.join(Global.Path.data, "auth.json")
const authLockFile = `${authFile}.lock`

afterEach(async () => {
  process.chdir(originalCwd)
  await Bun.write(authFile, "{}")
  await fs.unlink(authLockFile).catch(() => undefined)
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

describe("providers command", () => {
  test("default login provider set includes CLI bridge providers", () => {
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("claude-code")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("gemini-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("codex-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("grok-build-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("qoder-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("antigravity-cli")).toBe(true)
  })

  test("providers list reports saved credentials", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const infoSpy = vi.spyOn(prompts.log, "info").mockImplementation(() => {})

    try {
      await Auth.set("xai", { type: "api", key: "sk-test" })
      await ProvidersListCommand.handler({} as any)

      expect(infoSpy).toHaveBeenCalled()
      expect(infoSpy.mock.calls.some(([message]) => String(message).includes("Grok Cloud API"))).toBe(true)
      expect(outroSpy).toHaveBeenCalledWith("1 credentials")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  test("providers list labels CLI credentials as cli", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const infoSpy = vi.spyOn(prompts.log, "info").mockImplementation(() => {})

    try {
      await Auth.set("grok-build-cli", { type: "api", key: "cli" })
      await ProvidersListCommand.handler({} as any)

      expect(infoSpy).toHaveBeenCalled()
      expect(
        infoSpy.mock.calls.some((args) => {
          const message = String(args[0])
          return message.includes("Grok Build CLI") && message.includes("cli")
        }),
      ).toBe(true)
      expect(
        infoSpy.mock.calls.some((args) => {
          const message = String(args[0])
          return message.includes("Grok Build CLI") && message.includes("api")
        }),
      ).toBe(false)
      expect(outroSpy).toHaveBeenCalledWith("1 credentials")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  test("providers logout accepts a provider argument without opening selector", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const selectSpy = vi.spyOn(prompts, "select")
    const invalidateSpy = vi.spyOn(Provider, "invalidate").mockResolvedValue()

    try {
      await Auth.set("gemini-cli", { type: "api", key: "cli" })
      await ProvidersLogoutCommand.handler({ provider: "gemini-cli" } as any)

      expect(selectSpy).not.toHaveBeenCalled()
      expect(await Auth.get("gemini-cli")).toBeUndefined()
      expect(invalidateSpy).toHaveBeenCalled()
      expect(outroSpy).toHaveBeenCalledWith("Logout successful")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      selectSpy.mockRestore()
      invalidateSpy.mockRestore()
    }
  })

  test("providers logout fails fast in non-interactive mode without provider", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})
    const selectSpy = vi.spyOn(prompts, "select")
    const stdin = process.stdin as typeof process.stdin & { isTTY?: boolean }
    const originalIsTTY = stdin.isTTY

    try {
      stdin.isTTY = false
      await Auth.set("gemini-cli", { type: "api", key: "cli" })
      await ProvidersLogoutCommand.handler({} as any)

      expect(selectSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        "Provider is required in non-interactive mode. Use `ax-code providers logout --provider <id>`.",
      )
    } finally {
      stdin.isTTY = originalIsTTY
      introSpy.mockRestore()
      errorSpy.mockRestore()
      selectSpy.mockRestore()
    }
  })

  test("CLI provider login reports probe failures as user-facing errors", async () => {
    const src = await Bun.file(path.join(import.meta.dirname, "../../src/cli/cmd/providers.ts")).text()
    expect(src).toContain("const result = await probeCliProvider(provider).catch((error) => {")
    expect(src).toContain("prompts.log.error(toErrorMessage(error))")
  })

  test("auth command timeout waits for process kill to complete", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = (
      handler: (...args: any[]) => void,
      timeout?: number,
      ...args: any[]
    ): ReturnType<typeof setTimeout> => {
      return originalSetTimeout(handler, timeout === 30_000 ? 1 : timeout, ...args)
    }

    globalThis.setTimeout = setTimeoutSpy as typeof globalThis.setTimeout

    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const confirmSpy = vi.spyOn(prompts, "confirm").mockResolvedValue(true)
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})

    const stdout = new PassThrough()
    const stderr = new PassThrough()

    const proc = {
      exited: new Promise<number>(() => {}),
      stdout,
      stderr,
    }

    let killStarted = false
    let killCompleted = false
    vi.spyOn(Process, "spawn").mockReturnValue(proc as any)
    vi.spyOn(Process, "killProcessTree").mockImplementation(async () => {
      killStarted = true
      await new Promise<void>((resolve) => {
        originalSetTimeout(() => {
          killCompleted = true
          resolve()
        }, 20)
      })
    })

    vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue({
      ok: true,
      async json() {
        return {
          auth: {
            command: ["slow-auth-command"],
            env: "MY_AUTH_TOKEN",
          },
        }
      },
    } as any)

    try {
      await ProvidersLoginCommand.handler({ url: "https://example.com" } as any)
      expect(killStarted).toBe(true)
      expect(killCompleted).toBe(true)
      expect(errorSpy).toHaveBeenCalledWith("Auth command timed out after 30000ms")
      expect(outroSpy).toHaveBeenCalledWith("Done")
      expect(introSpy).toHaveBeenCalledWith("Add credential")
    } finally {
      confirmSpy.mockRestore()
      introSpy.mockRestore()
      outroSpy.mockRestore()
      errorSpy.mockRestore()
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test("well-known login rejects empty auth command tokens", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const confirmSpy = vi.spyOn(prompts, "confirm").mockResolvedValue(true)
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})
    const successSpy = vi.spyOn(prompts.log, "success").mockImplementation(() => {})

    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.end(" \n")
    stderr.end()

    vi.spyOn(Process, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
      stdout,
      stderr,
    } as any)
    vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue({
      ok: true,
      async json() {
        return {
          auth: {
            command: ["empty-auth-command"],
            env: "MY_AUTH_TOKEN",
          },
        }
      },
    } as any)

    try {
      await ProvidersLoginCommand.handler({ url: "https://example.com" } as any)

      expect(errorSpy).toHaveBeenCalledWith("Auth command returned an empty token")
      expect(successSpy).not.toHaveBeenCalled()
      expect(await Auth.get("https://example.com")).toBeUndefined()
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      confirmSpy.mockRestore()
      introSpy.mockRestore()
      outroSpy.mockRestore()
      errorSpy.mockRestore()
      successSpy.mockRestore()
    }
  })

  test("well-known login treats URL schemes case-insensitively", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})
    const passwordSpy = vi.spyOn(prompts, "password").mockResolvedValue("should-not-prompt")
    const assertSpy = vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    const fetchSpy = vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue({
      ok: true,
      async json() {
        return {
          auth: {
            command: ["auth-cli", 42],
            env: "MY_AUTH_TOKEN",
          },
        }
      },
    } as any)

    try {
      await ProvidersLoginCommand.handler({ url: "HTTPS://example.com" } as any)

      expect(passwordSpy).not.toHaveBeenCalled()
      expect(assertSpy).toHaveBeenCalledWith("HTTPS://example.com/.well-known/ax-code", "providers-add")
      expect(fetchSpy).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        "Well-known config has missing or invalid auth.command (expected non-empty string array)",
      )
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      errorSpy.mockRestore()
      passwordSpy.mockRestore()
      assertSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })

  test("well-known login rejects malformed auth command before prompting or spawning", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})
    const confirmSpy = vi.spyOn(prompts, "confirm")
    const spawnSpy = vi.spyOn(Process, "spawn")

    vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue({
      ok: true,
      async json() {
        return {
          auth: {
            command: ["auth-cli", 42],
            env: "MY_AUTH_TOKEN",
          },
        }
      },
    } as any)

    try {
      await ProvidersLoginCommand.handler({ url: "https://example.com" } as any)

      expect(errorSpy).toHaveBeenCalledWith(
        "Well-known config has missing or invalid auth.command (expected non-empty string array)",
      )
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(spawnSpy).not.toHaveBeenCalled()
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      errorSpy.mockRestore()
      confirmSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })
})
