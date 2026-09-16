import { afterEach, expect, test, vi } from "vitest"
import { Flag, parsePositiveIntegerFlagValue } from "../../src/flag/flag"

const originalConfigContent = process.env["AX_CODE_CONFIG_CONTENT"]
const originalModelsPath = process.env["AX_CODE_MODELS_PATH"]
const originalModelsUrl = process.env["AX_CODE_MODELS_URL"]
const originalAutonomous = process.env["AX_CODE_AUTONOMOUS"]
const originalSuperLong = process.env["AX_CODE_SUPER_LONG"]
const originalSuperLongOverride = process.env["AX_CODE_SUPER_LONG_SESSION_OVERRIDE"]
const originalShardSessions = process.env["AX_CODE_SHARD_SESSIONS"]
const originalAdvancedTerminal = process.env["AX_CODE_TUI_ADVANCED_TERMINAL"]
const originalTermProgram = process.env["TERM_PROGRAM"]
const originalTerm = process.env["TERM"]

afterEach(() => {
  vi.unstubAllEnvs()
  restoreEnv("AX_CODE_CONFIG_CONTENT", originalConfigContent)
  restoreEnv("AX_CODE_MODELS_PATH", originalModelsPath)
  restoreEnv("AX_CODE_MODELS_URL", originalModelsUrl)
  restoreEnv("AX_CODE_AUTONOMOUS", originalAutonomous)
  restoreEnv("AX_CODE_SUPER_LONG", originalSuperLong)
  restoreEnv("AX_CODE_SUPER_LONG_SESSION_OVERRIDE", originalSuperLongOverride)
  restoreEnv("AX_CODE_SHARD_SESSIONS", originalShardSessions)
  restoreEnv("AX_CODE_TUI_ADVANCED_TERMINAL", originalAdvancedTerminal)
  restoreEnv("TERM_PROGRAM", originalTermProgram)
  restoreEnv("TERM", originalTerm)
})

test("autonomous flag defaults on but honors explicit false", () => {
  delete process.env["AX_CODE_AUTONOMOUS"]
  expect(Flag.AX_CODE_AUTONOMOUS).toBe(true)

  process.env["AX_CODE_AUTONOMOUS"] = "false"
  expect(Flag.AX_CODE_AUTONOMOUS).toBe(false)

  process.env["AX_CODE_AUTONOMOUS"] = "true"
  expect(Flag.AX_CODE_AUTONOMOUS).toBe(true)
})

test("super-long flag honors session override before base env", () => {
  delete process.env["AX_CODE_SUPER_LONG"]
  delete process.env["AX_CODE_SUPER_LONG_SESSION_OVERRIDE"]
  expect(Flag.AX_CODE_SUPER_LONG).toBe(false)

  process.env["AX_CODE_SUPER_LONG"] = "false"
  process.env["AX_CODE_SUPER_LONG_SESSION_OVERRIDE"] = "true"
  expect(Flag.AX_CODE_SUPER_LONG).toBe(true)

  process.env["AX_CODE_SUPER_LONG"] = "true"
  process.env["AX_CODE_SUPER_LONG_SESSION_OVERRIDE"] = "false"
  expect(Flag.AX_CODE_SUPER_LONG).toBe(false)

  delete process.env["AX_CODE_SUPER_LONG_SESSION_OVERRIDE"]
  expect(Flag.AX_CODE_SUPER_LONG).toBe(true)
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

test("runtime config/model flags read process.env at access time", () => {
  process.env["AX_CODE_CONFIG_CONTENT"] = '{"username":"first"}'
  process.env["AX_CODE_MODELS_PATH"] = "/tmp/first-models.json"
  process.env["AX_CODE_MODELS_URL"] = "https://example.com/first-models.json"

  expect(Flag.AX_CODE_CONFIG_CONTENT).toBe('{"username":"first"}')
  expect(Flag.AX_CODE_MODELS_PATH).toBe("/tmp/first-models.json")
  expect(Flag.AX_CODE_MODELS_URL).toBe("https://example.com/first-models.json")

  process.env["AX_CODE_CONFIG_CONTENT"] = '{"username":"second"}'
  process.env["AX_CODE_MODELS_PATH"] = "/tmp/second-models.json"
  process.env["AX_CODE_MODELS_URL"] = "https://example.com/second-models.json"

  expect(Flag.AX_CODE_CONFIG_CONTENT).toBe('{"username":"second"}')
  expect(Flag.AX_CODE_MODELS_PATH).toBe("/tmp/second-models.json")
  expect(Flag.AX_CODE_MODELS_URL).toBe("https://example.com/second-models.json")
})

test("session sharding flag reads process.env at access time", () => {
  delete process.env["AX_CODE_SHARD_SESSIONS"]
  expect(Flag.AX_CODE_SHARD_SESSIONS).toBe(false)

  process.env["AX_CODE_SHARD_SESSIONS"] = "true"
  expect(Flag.AX_CODE_SHARD_SESSIONS).toBe(true)

  process.env["AX_CODE_SHARD_SESSIONS"] = "false"
  expect(Flag.AX_CODE_SHARD_SESSIONS).toBe(false)
})

test("advanced terminal flag reads host identity and overrides at access time", () => {
  for (const name of [
    "WT_SESSION",
    "VTE_VERSION",
    "SSH_CONNECTION",
    "SSH_CLIENT",
    "SSH_TTY",
    "MOSH_CONNECTION",
    "TMUX",
    "TMUX_PANE",
    "STY",
    "ZELLIJ",
  ]) {
    vi.stubEnv(name, undefined)
  }
  delete process.env["AX_CODE_TUI_ADVANCED_TERMINAL"]
  delete process.env["TERM_PROGRAM"]
  process.env["TERM"] = "xterm-256color"
  expect(Flag.AX_CODE_TUI_ADVANCED_TERMINAL).toBe(false)

  process.env["TERM_PROGRAM"] = "ghostty"
  expect(Flag.AX_CODE_TUI_ADVANCED_TERMINAL).toBe(true)

  process.env["AX_CODE_TUI_ADVANCED_TERMINAL"] = "0"
  expect(Flag.AX_CODE_TUI_ADVANCED_TERMINAL).toBe(false)

  delete process.env["TERM_PROGRAM"]
  delete process.env["AX_CODE_TUI_ADVANCED_TERMINAL"]
  vi.stubEnv("WT_SESSION", "terminal-session")
  expect(Flag.AX_CODE_TUI_ADVANCED_TERMINAL).toBe(true)

  vi.stubEnv("WT_SESSION", undefined)
  vi.stubEnv("VTE_VERSION", "7802")
  expect(Flag.AX_CODE_TUI_ADVANCED_TERMINAL).toBe(true)

  vi.stubEnv("SSH_TTY", "/dev/pts/1")
  expect(Flag.AX_CODE_TUI_ADVANCED_TERMINAL).toBe(false)

  process.env["AX_CODE_TUI_ADVANCED_TERMINAL"] = "1"
  expect(Flag.AX_CODE_TUI_ADVANCED_TERMINAL).toBe(true)
})

test("positive integer flag parser rejects non-decimal numerics", () => {
  expect(parsePositiveIntegerFlagValue(undefined)).toBeUndefined()
  expect(parsePositiveIntegerFlagValue("")).toBeUndefined()
  expect(parsePositiveIntegerFlagValue("42")).toBe(42)
  expect(parsePositiveIntegerFlagValue(" 42 ")).toBe(42)
  expect(parsePositiveIntegerFlagValue("0")).toBeUndefined()
  expect(parsePositiveIntegerFlagValue("-1")).toBeUndefined()
  expect(parsePositiveIntegerFlagValue("1.5")).toBeUndefined()
  expect(parsePositiveIntegerFlagValue("1e3")).toBeUndefined()
  expect(parsePositiveIntegerFlagValue("0x10")).toBeUndefined()
})
