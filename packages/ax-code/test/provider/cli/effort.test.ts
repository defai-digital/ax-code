import { describe, expect, test } from "vitest"
import {
  cliEffortArgs,
  cliEffortFromProviderOptions,
  cliEffortVariants,
  cliModelEfforts,
} from "../../../src/provider/cli/effort"
import { buildCliCommand } from "../../../src/provider/cli/cli-language-model"
import { getCliProviderDefinition } from "../../../src/provider/cli/config"

describe("CLI effort levels", () => {
  test("model efforts from the CLI cache replace the provider default list", () => {
    const efforts = cliModelEfforts({ cliEfforts: ["low", "high", "max", "ultra"] })
    expect(Object.keys(cliEffortVariants("codex-cli", efforts))).toEqual(["low", "high", "max", "ultra"])
    expect(Object.keys(cliEffortVariants("codex-cli"))).toEqual(["minimal", "low", "medium", "high", "xhigh"])
    expect(cliEffortArgs("codex-cli", "ultra", efforts)).toEqual(["-c", 'model_reasoning_effort="ultra"'])
    expect(cliEffortArgs("codex-cli", "minimal", efforts)).toEqual([])
  })

  test("rejects malformed cached efforts", () => {
    expect(cliModelEfforts({ cliEfforts: ['x"; rm', 7] })).toBeUndefined()
    expect(cliModelEfforts({ cliEfforts: "high" })).toBeUndefined()
    expect(cliModelEfforts(undefined)).toBeUndefined()
  })

  test("unknown providers publish no efforts even with cached ones", () => {
    expect(cliEffortVariants("other-cli", ["high"])).toEqual({})
  })

  test("the subprocess receives an effort only the model accepts", () => {
    const grok = getCliProviderDefinition("grok-build-cli")!
    const config = {
      providerID: "grok-build-cli",
      modelID: "grok-4.7",
      binary: "grok",
      args: grok.args,
      parser: grok.parser,
      promptMode: grok.promptMode,
      promptFlag: grok.promptFlag,
      efforts: ["low", "medium", "high", "xhigh"],
    }
    const effort = cliEffortFromProviderOptions(
      "grok-build-cli",
      { "grok-build-cli": { effort: "xhigh" } },
      config.efforts,
    )
    expect(effort).toBe("xhigh")
    expect(buildCliCommand(config, "/tmp/prompt", undefined, effort)).toContain("xhigh")
    expect(cliEffortFromProviderOptions("grok-build-cli", { "grok-build-cli": { effort: "xhigh" } })).toBeUndefined()
  })
})
