import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { PassThrough } from "node:stream"
import { Auth } from "../../src/auth"
import { DEFAULT_LOGIN_PROVIDER_IDS, ProvidersLoginCommand, ProvidersListCommand } from "../../src/cli/cmd/providers"
import { Process } from "../../src/util/process"
import { Ssrf } from "../../src/util/ssrf"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"

const originalCwd = process.cwd()
const authFile = path.join(Global.Path.data, "auth.json")
const authLockFile = `${authFile}.lock`

afterEach(async () => {
  process.chdir(originalCwd)
  await Bun.write(authFile, "{}")
  await fs.unlink(authLockFile).catch(() => undefined)
  await Instance.disposeAll()
  mock.restore()
})

describe("providers command", () => {
  test("default login provider set includes CLI bridge providers", () => {
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("claude-code")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("gemini-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("codex-cli")).toBe(true)
  })

  test("providers list reports saved credentials", async () => {
    const introSpy = spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = spyOn(prompts, "outro").mockImplementation(() => {})
    const infoSpy = spyOn(prompts.log, "info").mockImplementation(() => {})

    try {
      await Auth.set("xai", { type: "api", key: "sk-test" })
      await ProvidersListCommand.handler({} as any)

      expect(infoSpy).toHaveBeenCalled()
      expect(
        infoSpy.mock.calls.some(([message]) => String(message).includes("xAI") || String(message).includes("xai")),
      ).toBe(true)
      expect(outroSpy).toHaveBeenCalledWith("1 credentials")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  test("auth command timeout waits for process kill to complete", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = (handler: (...args: any[]) => void, timeout?: number, ...args: any[]): ReturnType<typeof setTimeout> => {
      return originalSetTimeout(handler, timeout === 30_000 ? 1 : timeout, ...args)
    }

    globalThis.setTimeout = setTimeoutSpy as typeof globalThis.setTimeout

    const introSpy = spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = spyOn(prompts, "outro").mockImplementation(() => {})
    const confirmSpy = spyOn(prompts, "confirm").mockResolvedValue(true)
    const errorSpy = spyOn(prompts.log, "error").mockImplementation(() => {})

    const stdout = new PassThrough()
    const stderr = new PassThrough()

    const proc = {
      exited: new Promise<number>(() => {}),
      stdout,
      stderr,
    }

    let killStarted = false
    let killCompleted = false
    spyOn(Process, "spawn").mockReturnValue(proc as any)
    spyOn(Process, "killProcessTree").mockImplementation(async () => {
      killStarted = true
      await new Promise<void>((resolve) => {
        originalSetTimeout(() => {
          killCompleted = true
          resolve()
        }, 20)
      })
    })

    spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    spyOn(Ssrf, "pinnedFetch").mockResolvedValue({
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
})
