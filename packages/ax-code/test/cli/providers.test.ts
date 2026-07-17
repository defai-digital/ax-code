import { afterEach, describe, expect, test, vi } from "vitest"
import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import {
  DEFAULT_LOGIN_PROVIDER_IDS,
  ProvidersAxEngineCommand,
  ProvidersLoginCommand,
  ProvidersListCommand,
  ProvidersLogoutCommand,
} from "../../src/cli/cmd/providers"
import { Process } from "../../src/util/process"
import { Ssrf } from "../../src/util/ssrf"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { AX_ENGINE_QUANTIZATION_IDS } from "../../src/provider/ax-engine"

const originalCwd = process.cwd()
const authFile = path.join(Global.Path.data, "auth.json")
const authLockFile = `${authFile}.lock`

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.writeFile(authFile, "{}")
  await fs.unlink(authLockFile).catch(() => undefined)
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

describe("providers command", () => {
  test("default login provider set includes CLI bridge providers", () => {
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("xai")).toBe(false)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("google")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("groq")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("openrouter")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("github-copilot")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("claude-code")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("gemini-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("codex-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("grok-build-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("qoder-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("antigravity-cli")).toBe(true)
    expect(DEFAULT_LOGIN_PROVIDER_IDS.has("kimi-cli")).toBe(true)
  })

  test("providers login accepts default Cloud API provider ids directly", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})
    const passwordSpy = vi.spyOn(prompts, "password").mockResolvedValue("test-google-key")

    try {
      await ProvidersLoginCommand.handler({ provider: "google" } as any)

      expect(errorSpy).not.toHaveBeenCalledWith('Unknown provider "google"')
      expect(passwordSpy).toHaveBeenCalledWith({
        message: "Enter your API key",
        validate: expect.any(Function),
      })
      expect(await Auth.get("google")).toEqual({ type: "api", key: "test-google-key" })
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      await Auth.remove("google").catch(() => undefined)
      introSpy.mockRestore()
      outroSpy.mockRestore()
      errorSpy.mockRestore()
      passwordSpy.mockRestore()
    }
  })

  test("ax-engine quantization choices match the supported catalog", () => {
    const options = new Map<string, Record<string, unknown>>()
    const yargs = {
      positional() {
        return yargs
      },
      option(name: string, config: Record<string, unknown>) {
        options.set(name, config)
        return yargs
      },
    }

    ;(ProvidersAxEngineCommand.builder as Function)(yargs)

    expect(options.get("quantization")?.choices).toBe(AX_ENGINE_QUANTIZATION_IDS)
    expect(options.get("quantization")?.choices).not.toContain("mlx4bit")
  })

  test("providers list reports saved credentials", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const infoSpy = vi.spyOn(prompts.log, "info").mockImplementation(() => {})

    try {
      await Auth.set("xai", { type: "api", key: "sk-test" })
      await ProvidersListCommand.handler({} as any)

      expect(infoSpy).toHaveBeenCalled()
      expect(
        infoSpy.mock.calls.some(([message]) => {
          const text = String(message)
          return (
            (text.includes("Grok Cloud API") || text.includes("xAI") || text.includes("xai")) && text.includes("api")
          )
        }),
      ).toBe(true)
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
          return (message.includes("Grok Build CLI") || message.includes("grok-build-cli")) && message.includes("cli")
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
    const src = await fs.readFile(path.join(import.meta.dirname, "../../src/cli/cmd/providers-impl.ts"), "utf-8")
    expect(src).toContain("const result = await probeCliProvider(provider).catch((error) => {")
    expect(src).toContain("prompts.log.error(toErrorMessage(error))")
  })

  test("well-known login stores a manually entered token", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const passwordSpy = vi.spyOn(prompts, "password").mockResolvedValue("well-known-token")
    const successSpy = vi.spyOn(prompts.log, "success").mockImplementation(() => {})
    const spawnSpy = vi.spyOn(Process, "spawn")

    vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue({
      ok: true,
      async json() {
        return {
          auth: {
            env: "MY_AUTH_TOKEN",
          },
        }
      },
    } as any)

    try {
      await ProvidersLoginCommand.handler({ url: "https://example.com" } as any)

      expect(passwordSpy).toHaveBeenCalledWith({
        message: "Enter token for https://example.com",
        validate: expect.any(Function),
      })
      expect(spawnSpy).not.toHaveBeenCalled()
      expect(await Auth.get("https://example.com")).toEqual({
        type: "wellknown",
        key: "MY_AUTH_TOKEN",
        token: "well-known-token",
      })
      expect(successSpy).toHaveBeenCalledWith("Logged into https://example.com")
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      passwordSpy.mockRestore()
      successSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })

  test("well-known login ignores remote auth commands", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const successSpy = vi.spyOn(prompts.log, "success").mockImplementation(() => {})
    const passwordSpy = vi.spyOn(prompts, "password").mockResolvedValue("manual-token")
    const spawnSpy = vi.spyOn(Process, "spawn")
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

      expect(spawnSpy).not.toHaveBeenCalled()
      expect(passwordSpy).toHaveBeenCalled()
      expect(await Auth.get("https://example.com")).toEqual({
        type: "wellknown",
        key: "MY_AUTH_TOKEN",
        token: "manual-token",
      })
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      successSpy.mockRestore()
      passwordSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })

  test("well-known login treats URL schemes case-insensitively", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})
    const successSpy = vi.spyOn(prompts.log, "success").mockImplementation(() => {})
    const passwordSpy = vi.spyOn(prompts, "password").mockResolvedValue("case-token")
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

      expect(passwordSpy).toHaveBeenCalledWith({
        message: "Enter token for HTTPS://example.com",
        validate: expect.any(Function),
      })
      expect(assertSpy).toHaveBeenCalledWith("HTTPS://example.com/.well-known/ax-code", "providers-add")
      expect(fetchSpy).toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(await Auth.get("HTTPS://example.com")).toEqual({
        type: "wellknown",
        key: "MY_AUTH_TOKEN",
        token: "case-token",
      })
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      errorSpy.mockRestore()
      successSpy.mockRestore()
      passwordSpy.mockRestore()
      assertSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })

  test("well-known login rejects malformed auth env before prompting or spawning", async () => {
    const introSpy = vi.spyOn(prompts, "intro").mockImplementation(() => {})
    const outroSpy = vi.spyOn(prompts, "outro").mockImplementation(() => {})
    const errorSpy = vi.spyOn(prompts.log, "error").mockImplementation(() => {})
    const passwordSpy = vi.spyOn(prompts, "password")
    const spawnSpy = vi.spyOn(Process, "spawn")

    vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue({
      ok: true,
      async json() {
        return {
          auth: {
            command: ["auth-cli"],
            env: "lowercase_token",
          },
        }
      },
    } as any)

    try {
      await ProvidersLoginCommand.handler({ url: "https://example.com" } as any)

      expect(errorSpy).toHaveBeenCalledWith(
        "Well-known config has missing or invalid auth.env (expected uppercase env var name)",
      )
      expect(passwordSpy).not.toHaveBeenCalled()
      expect(spawnSpy).not.toHaveBeenCalled()
      expect(outroSpy).toHaveBeenCalledWith("Done")
    } finally {
      introSpy.mockRestore()
      outroSpy.mockRestore()
      errorSpy.mockRestore()
      passwordSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })
})
