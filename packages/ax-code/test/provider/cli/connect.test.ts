import { describe, expect, test, vi } from "vitest"
import { PassThrough } from "node:stream"
import { checkCliProviderAuth, probeCliLanguageModel } from "../../../src/provider/cli/connect"
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

  test("bundled CLI providers have no pre-probe auth check", async () => {
    const run = vi.spyOn(Process, "run")
    try {
      for (const [providerID, binary] of [
        ["codex-cli", "codex"],
        ["grok-build-cli", "grok"],
        ["kimi-cli", "kimi"],
        ["minimax-cli", "mcode"],
        ["dsh-cli", "dsh"],
      ]) {
        await expect(checkCliProviderAuth(providerID, binary)).resolves.toBeUndefined()
      }
      expect(run).not.toHaveBeenCalled()
    } finally {
      run.mockRestore()
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
