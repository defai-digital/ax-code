import { describe, expect, spyOn, test } from "bun:test"
import { checkCliProviderAuth, probeCliLanguageModel } from "../../../src/provider/cli/connect"
import { Process } from "../../../src/util/process"

describe("probeCliLanguageModel", () => {
  test("succeeds when the CLI process exits cleanly", async () => {
    await expect(
      probeCliLanguageModel({
        providerID: "test-cli",
        modelID: "test-model",
        binary: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
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
        args: ["-e", "process.stdout.write('broken probe'); process.exit(7)"],
        parser: {
          parseComplete: (output: string) => ({ text: output.trim() }),
          parseStreamLine: () => null,
        },
        promptMode: "stdin",
      }),
    ).rejects.toThrow(/CLI exited with code 7: broken probe/)
  })

  test("Claude auth probe includes --verbose for stream-json compatibility", async () => {
    const runSpy = spyOn(Process, "run").mockResolvedValue({
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      code: 0,
      exitCode: 0,
      text() {
        return ""
      },
    } as any)

    try {
      await expect(checkCliProviderAuth("claude-code", "claude")).resolves.toBeUndefined()
      expect(runSpy).toHaveBeenCalledTimes(1)
      expect(runSpy.mock.calls[0]?.[0]).toEqual([
        "claude",
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "ping",
      ])
    } finally {
      runSpy.mockRestore()
    }
  })
})
