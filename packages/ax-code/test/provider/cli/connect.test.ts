import { describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { PassThrough } from "node:stream"
import {
  checkCliProviderAuth,
  checkCliProviderStatus,
  probeCliLanguageModel,
  probeCliProvider,
} from "../../../src/provider/cli/connect"
import { getCliProviderDefinition } from "../../../src/provider/cli/config"
import { Process } from "../../../src/util/process"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

function successfulChild(output: string) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const exited = new Promise<number>((resolve) => {
    setTimeout(() => {
      stdout.end(output)
      stderr.end()
      resolve(0)
    }, 0)
  })
  return {
    stdout,
    stderr,
    stdin,
    exited,
    exitCode: null,
    signalCode: null,
    kill: () => true,
    pid: 123,
  } as any
}

describe("probeCliLanguageModel", () => {
  test("succeeds when the CLI process exits cleanly", async () => {
    await expect(
      probeCliLanguageModel({
        providerID: "test-cli",
        modelID: "test-model",
        binary: process.execPath,
        args: ["-e", "process.stdout.write('ok')", "--"],
        parser: {
          parseComplete: (output: string) => ({ text: output.trim() }),
          parseStreamLine: () => null,
        },
        promptMode: "stdin",
      }),
    ).resolves.toBeUndefined()
  })

  test("surfaces subprocess failures with stdout details", async () => {
    await expect(
      probeCliLanguageModel({
        providerID: "test-cli",
        modelID: "test-model",
        binary: process.execPath,
        args: ["-e", "process.stdout.write('broken probe'); process.exit(7)", "--"],
        parser: {
          parseComplete: (output: string) => ({ text: output.trim() }),
          parseStreamLine: () => null,
        },
        promptMode: "stdin",
      }),
    ).rejects.toThrow(/CLI exited with code 7: broken probe/)
  })

  function runResult(code: number, stdout = "", stderr = "") {
    return {
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      code,
      exitCode: code,
      text() {
        return `${stdout}${stderr}`
      },
    } as any
  }

  test("Claude status check uses the free auth status command", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "anthropic-key"
    const runSpy = vi
      .spyOn(Process, "run")
      .mockResolvedValue(runResult(0, JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })))

    try {
      await expect(checkCliProviderStatus("claude-code", "claude")).resolves.toMatchObject({
        state: "authenticated",
      })
      expect(runSpy).toHaveBeenCalledTimes(1)
      expect(runSpy.mock.calls[0]?.[0]).toEqual(["claude", "auth", "status", "--json"])
      expect(runSpy.mock.calls[0]?.[1]?.env?.ANTHROPIC_API_KEY).toBe("anthropic-key")
    } finally {
      runSpy.mockRestore()
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  test("Claude status check reports a logged-out JSON response", async () => {
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(0, JSON.stringify({ loggedIn: false })))
    try {
      const status = await checkCliProviderStatus("claude-code", "claude")
      expect(status.state).toBe("unauthenticated")
      expect(status.message).toContain("Claude CLI is not logged in")
      await expect(checkCliProviderAuth("claude-code", "claude")).resolves.toContain("Claude CLI is not logged in")
    } finally {
      runSpy.mockRestore()
    }
  })

  test("Claude status check treats a non-zero exit as signed out", async () => {
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(1, "", "not signed in"))
    try {
      const status = await checkCliProviderStatus("claude-code", "claude")
      expect(status.state).toBe("unauthenticated")
      expect(status.message).toContain("Claude CLI is not logged in")
    } finally {
      runSpy.mockRestore()
    }
  })

  test("Claude status check leaves unknown output unverified instead of failing", async () => {
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(0, "unexpected status text"))
    try {
      await expect(checkCliProviderStatus("claude-code", "claude")).resolves.toMatchObject({ state: "unverified" })
      await expect(checkCliProviderAuth("claude-code", "claude")).resolves.toBeUndefined()
    } finally {
      runSpy.mockRestore()
    }
  })

  test("Codex status check uses the free login status command", async () => {
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(0, "Logged in using ChatGPT\n"))
    try {
      await expect(checkCliProviderStatus("codex-cli", "codex")).resolves.toMatchObject({
        state: "authenticated",
      })
      expect(runSpy.mock.calls[0]?.[0]).toEqual(["codex", "login", "status"])
    } finally {
      runSpy.mockRestore()
    }
  })

  test("Codex status check reports a non-zero exit as signed out", async () => {
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(1, "Not logged in\n"))
    try {
      const status = await checkCliProviderStatus("codex-cli", "codex")
      expect(status.state).toBe("unauthenticated")
      expect(status.message).toContain("Codex CLI is not logged in")
    } finally {
      runSpy.mockRestore()
    }
  })

  test("Codex status check leaves unknown output unverified instead of failing", async () => {
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(0, "unexpected status text"))
    try {
      await expect(checkCliProviderStatus("codex-cli", "codex")).resolves.toMatchObject({ state: "unverified" })
      await expect(checkCliProviderAuth("codex-cli", "codex")).resolves.toBeUndefined()
    } finally {
      runSpy.mockRestore()
    }
  })

  test("discovery never invokes inference for providers without a status command", async () => {
    const runSpy = vi.spyOn(Process, "run")
    const spawnSpy = vi.spyOn(Process, "spawn")
    try {
      await expect(checkCliProviderAuth("grok-build-cli", "grok")).resolves.toBeUndefined()
      await expect(checkCliProviderAuth("muse-cli", "muse")).resolves.toBeUndefined()
      expect(runSpy).not.toHaveBeenCalled()
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      runSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })

  test("Claude discovery uses only the free status command", async () => {
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(0, JSON.stringify({ loggedIn: true })))
    const spawnSpy = vi.spyOn(Process, "spawn")
    try {
      await expect(checkCliProviderAuth("claude-code", "claude")).resolves.toBeUndefined()
      expect(runSpy.mock.calls[0]?.[0]).toEqual(["claude", "auth", "status", "--json"])
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      runSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })

  test.skipIf(process.platform === "win32")("probe resolves the binary with the runtime resolver", async () => {
    await using tmp = await tmpdir()
    const binDir = path.join(tmp.path, "bin")
    await fs.mkdir(binDir)
    const binary = path.join(binDir, "codex")
    await fs.writeFile(binary, "#!/bin/sh\n")
    await fs.chmod(binary, 0o755)
    vi.stubEnv("PATH", binDir)
    vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
    const runSpy = vi.spyOn(Process, "run").mockResolvedValue(runResult(0, "Logged in using ChatGPT\n"))
    const spawnSpy = vi.spyOn(Process, "spawn")

    try {
      const result = await probeCliProvider("codex-cli")
      expect(path.normalize(result.binary)).toBe(path.normalize(binary))
      expect(runSpy.mock.calls[0]?.[0]).toEqual([binary, "login", "status"])
      // Status check alone is enough for Codex: no inference probe.
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      runSpy.mockRestore()
      spawnSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  test("probe passes bundled workspaceArg into the spawned CLI", async () => {
    await using tmp = await tmpdir()
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementation(() => successfulChild('{"payload_type":"run.output.delta","payload":{"text":"OK"}}\n'))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await probeCliLanguageModel({
            providerID: "muse-cli",
            modelID: "muse-cli",
            binary: "muse",
          })
        },
      })

      const cmd = spawn.mock.calls[0]?.[0] as string[]
      expect(cmd).toContain("--trust-workspace")
      expect(cmd).toContain("--workspace")
      expect(cmd[cmd.indexOf("--workspace") + 1]).toBe(tmp.path)
    } finally {
      spawn.mockRestore()
    }
  })

  test("probe passes MiniMax --cwd from the bundled definition", async () => {
    await using tmp = await tmpdir()
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementation(() =>
        successfulChild('{"type":"item.completed","item":{"id":"item_1","type":"assistant_message","text":"OK"}}\n'),
      )

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await probeCliLanguageModel({
            providerID: "minimax-cli",
            modelID: "minimax-cli",
            binary: "mcode",
          })
        },
      })

      const cmd = spawn.mock.calls[0]?.[0] as string[]
      expect(cmd).toContain("--cwd")
      expect(cmd[cmd.indexOf("--cwd") + 1]).toBe(tmp.path)
      expect(cmd).toContain("--input")
      expect(cmd).toContain("-")
    } finally {
      spawn.mockRestore()
    }
  })
})

describe("getCliProviderDefinition", () => {
  test("ignores inherited object keys", async () => {
    // Regression: `providers login constructor` resolved Object.prototype's
    // constructor as a CLI provider and failed with "Sign in with the undefined CLI".
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(getCliProviderDefinition(id), id).toBeUndefined()
    }
    expect(getCliProviderDefinition("codex-cli")?.binary).toBe("codex")
    await expect(probeCliProvider("constructor")).rejects.toThrow("Unsupported CLI provider: constructor")
  })
})
