import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  CliLanguageModel,
  buildCliCommand,
  resetRejectedOptionalCliFlags,
} from "../../../src/provider/cli/cli-language-model"
import { CLI_PROVIDER_DEFINITIONS } from "../../../src/provider/cli/config"
import {
  CliIsolationUnsupportedError,
  cliIsolationArgs,
  currentCliIsolationMode,
  provideCliIsolationMode,
} from "../../../src/provider/cli/isolation"
import { Isolation } from "../../../src/isolation"
import { Process } from "../../../src/util/process"
import { claudeCodeParser, kimiCliParser } from "../../../src/provider/cli/parser"

const PROVIDERS = [
  "claude-code",
  "codex-cli",
  "grok-build-cli",
  "kimi-cli",
  "muse-cli",
  "minimax-cli",
  "dsh-cli",
] as const

const originalIsolationMode = process.env.AX_CODE_ISOLATION_MODE
const originalAutonomous = process.env.AX_CODE_AUTONOMOUS

function restoreEnv(key: "AX_CODE_ISOLATION_MODE" | "AX_CODE_AUTONOMOUS", value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  resetRejectedOptionalCliFlags()
  restoreEnv("AX_CODE_AUTONOMOUS", "false")
})

afterEach(() => {
  restoreEnv("AX_CODE_ISOLATION_MODE", originalIsolationMode)
  restoreEnv("AX_CODE_AUTONOMOUS", originalAutonomous)
})

function expectUnsupported(run: () => unknown, mode: Isolation.Mode) {
  let error: unknown
  try {
    run()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(CliIsolationUnsupportedError)
  expect((error as Error).name).toBe("CliIsolationUnsupportedError")
  expect((error as Error).message).toContain(`cannot enforce AX Code's ${mode} isolation mode`)
}

describe("cliIsolationArgs", () => {
  test("full-access preserves each CLI's headless defaults", () => {
    for (const providerID of PROVIDERS) {
      for (const autonomous of [false, true]) {
        const expected = providerID === "claude-code" && autonomous ? ["--dangerously-skip-permissions"] : []
        expect(cliIsolationArgs(providerID, "full-access", autonomous)).toEqual({ args: expected })
      }
    }
  })

  test("read-only maps each supporting provider and rejects unsupported ones", () => {
    expect(cliIsolationArgs("claude-code", "read-only", false)).toEqual({
      args: ["--permission-mode", "dontAsk", "--tools", "Read,Glob,Grep"],
    })
    expect(cliIsolationArgs("claude-code", "read-only", true).args).not.toContain("--dangerously-skip-permissions")
    expect(cliIsolationArgs("codex-cli", "read-only", false)).toEqual({ args: ["--sandbox", "read-only"] })
    expect(cliIsolationArgs("grok-build-cli", "read-only", false)).toEqual({ args: ["--permission-mode", "plan"] })
    expect(cliIsolationArgs("dsh-cli", "read-only", false)).toEqual({
      args: [],
      replace: { flag: "--permission-mode", value: "read-only" },
    })
    for (const providerID of ["kimi-cli", "muse-cli", "minimax-cli"] as const) {
      expectUnsupported(() => cliIsolationArgs(providerID, "read-only", false), "read-only")
      expectUnsupported(() => cliIsolationArgs(providerID, "read-only", true), "read-only")
    }
    // Anything not listed keeps its headless argv.
    expect(cliIsolationArgs("custom-cli", "read-only", false)).toEqual({ args: [] })
  })

  test("workspace-write maps each supporting provider and rejects unsupported ones", () => {
    expect(cliIsolationArgs("claude-code", "workspace-write", false)).toEqual({
      args: ["--permission-mode", "acceptEdits"],
    })
    expect(cliIsolationArgs("claude-code", "workspace-write", true).args).not.toContain(
      "--dangerously-skip-permissions",
    )
    expect(cliIsolationArgs("codex-cli", "workspace-write", false)).toEqual({
      args: ["--sandbox", "workspace-write"],
    })
    expect(cliIsolationArgs("grok-build-cli", "workspace-write", false)).toEqual({ args: [] })
    expect(cliIsolationArgs("muse-cli", "workspace-write", false)).toEqual({ args: [] })
    expect(cliIsolationArgs("dsh-cli", "workspace-write", false)).toEqual({ args: [] })
    for (const providerID of ["kimi-cli", "minimax-cli"] as const) {
      expectUnsupported(() => cliIsolationArgs(providerID, "workspace-write", false), "workspace-write")
      expectUnsupported(() => cliIsolationArgs(providerID, "workspace-write", true), "workspace-write")
    }
    expect(cliIsolationArgs("custom-cli", "workspace-write", false)).toEqual({ args: [] })
  })
})

describe("session isolation context", () => {
  test("provided mode takes precedence over the environment", () => {
    process.env.AX_CODE_ISOLATION_MODE = "full-access"
    expect(currentCliIsolationMode()).toBeUndefined()
    expect(provideCliIsolationMode("read-only", () => currentCliIsolationMode())).toBe("read-only")
    expect(provideCliIsolationMode("workspace-write", () => currentCliIsolationMode())).toBe("workspace-write")
    expect(currentCliIsolationMode()).toBeUndefined()
  })
})

describe("buildCliCommand isolation integration", () => {
  test("read-only adds Claude Code's read-only permission mode", () => {
    process.env.AX_CODE_ISOLATION_MODE = "read-only"
    const definition = CLI_PROVIDER_DEFINITIONS["claude-code"]!
    const cmd = buildCliCommand(
      {
        providerID: "claude-code",
        modelID: "claude-code",
        binary: definition.binary,
        args: definition.args,
        parser: definition.parser,
        promptMode: definition.promptMode,
      },
      "hello",
    )
    expect(cmd).toEqual(expect.arrayContaining(["--permission-mode", "dontAsk", "--tools", "Read,Glob,Grep"]))
    expect(cmd).not.toContain("--dangerously-skip-permissions")
    expect(cmd.filter((arg) => arg === "--permission-mode")).toHaveLength(1)
  })

  test("workspace-write adds Codex's sandbox mode", () => {
    process.env.AX_CODE_ISOLATION_MODE = "workspace-write"
    const definition = CLI_PROVIDER_DEFINITIONS["codex-cli"]!
    const cmd = buildCliCommand(
      {
        providerID: "codex-cli",
        modelID: "codex-cli",
        binary: definition.binary,
        args: definition.args,
        parser: definition.parser,
        promptMode: definition.promptMode,
      },
      "hello",
    )
    expect(cmd).toEqual(expect.arrayContaining(["--sandbox", "workspace-write"]))
    expect(cmd.filter((arg) => arg === "--sandbox")).toHaveLength(1)
  })

  test("full-access keeps Grok Build unchanged", () => {
    process.env.AX_CODE_ISOLATION_MODE = "full-access"
    const definition = CLI_PROVIDER_DEFINITIONS["grok-build-cli"]!
    const cmd = buildCliCommand(
      {
        providerID: "grok-build-cli",
        modelID: "grok-build-cli",
        binary: definition.binary,
        args: definition.args,
        parser: definition.parser,
        promptMode: definition.promptMode,
        promptFlag: definition.promptFlag,
      },
      "/tmp/prompt.txt",
    )
    expect(cmd).toEqual(["grok", "--output-format", "streaming-json", "--prompt-file", "/tmp/prompt.txt"])
  })

  test("read-only replaces dsh's permission mode with a single flag", () => {
    process.env.AX_CODE_ISOLATION_MODE = "read-only"
    const definition = CLI_PROVIDER_DEFINITIONS["dsh-cli"]!
    const cmd = buildCliCommand(
      {
        providerID: "dsh-cli",
        modelID: "dsh-cli",
        binary: definition.binary,
        args: definition.args,
        parser: definition.parser,
        promptMode: definition.promptMode,
      },
      "summarize",
    )
    expect(cmd.filter((arg) => arg === "--permission-mode")).toHaveLength(1)
    expect(cmd[cmd.indexOf("--permission-mode") + 1]).toBe("read-only")
    expect(cmd).not.toContain("workspace-write")
  })

  test("full-access keeps every provider's argv free of isolation flags", () => {
    process.env.AX_CODE_ISOLATION_MODE = "full-access"
    for (const providerID of PROVIDERS) {
      const definition = CLI_PROVIDER_DEFINITIONS[providerID]!
      const cmd = buildCliCommand(
        {
          providerID,
          modelID: providerID,
          binary: definition.binary,
          args: definition.args,
          optionalArgs: definition.optionalArgs,
          parser: definition.parser,
          promptMode: definition.promptMode,
          promptFlag: definition.promptFlag,
          workspaceArg: definition.workspaceArg,
        },
        "/tmp/prompt.txt",
        "/repo",
      )
      expect(cmd).not.toContain("--sandbox")
      expect(cmd).not.toContain("--dangerously-skip-permissions")
      if (providerID !== "dsh-cli") expect(cmd).not.toContain("--permission-mode")
      if (providerID === "dsh-cli") {
        expect(cmd.filter((arg) => arg === "--permission-mode")).toHaveLength(1)
        expect(cmd[cmd.indexOf("--permission-mode") + 1]).toBe("workspace-write")
      }
    }
  })

  test("unsupported combinations throw before spawning", async () => {
    process.env.AX_CODE_ISOLATION_MODE = "read-only"
    const spawn = vi.spyOn(Process, "spawn")
    const model = new CliLanguageModel({
      providerID: "kimi-cli",
      modelID: "kimi-cli",
      binary: "kimi",
      args: CLI_PROVIDER_DEFINITIONS["kimi-cli"]!.args,
      parser: kimiCliParser,
      promptMode: "arg",
      promptFlag: "-p",
    })
    try {
      await expect(
        model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
      ).rejects.toThrow(CliIsolationUnsupportedError)
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      spawn.mockRestore()
    }
  })

  test("kimi read-only buildCliCommand throws the named error", () => {
    process.env.AX_CODE_ISOLATION_MODE = "read-only"
    expect(() =>
      buildCliCommand(
        {
          providerID: "kimi-cli",
          modelID: "kimi-cli",
          binary: "kimi",
          args: CLI_PROVIDER_DEFINITIONS["kimi-cli"]!.args,
          parser: claudeCodeParser,
          promptMode: "arg",
          promptFlag: "-p",
        },
        "hi",
      ),
    ).toThrow(CliIsolationUnsupportedError)
  })
})
