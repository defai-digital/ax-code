import { describe, expect, test } from "bun:test"
import { probeCliLanguageModel } from "../../../src/provider/cli/connect"

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
})
