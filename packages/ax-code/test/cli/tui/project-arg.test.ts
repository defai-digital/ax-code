import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  formatUnknownCommandError,
  isBareCommandWord,
  knownCommands,
  setKnownCommands,
  unknownProjectError,
} from "../../../src/cli/cmd/tui/project-arg"

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..")
const THREAD_SRC = readFileSync(path.join(PACKAGE_ROOT, "src/cli/cmd/tui/thread.ts"), "utf8")
const BOOT_SRC = readFileSync(path.join(PACKAGE_ROOT, "src/cli/boot.ts"), "utf8")

describe("isBareCommandWord (#414)", () => {
  test("treats plain command-like words as bare", () => {
    expect(isBareCommandWord("config")).toBe(true)
    expect(isBareCommandWord("snapshot")).toBe(true)
    expect(isBareCommandWord("typo-cmd")).toBe(true)
  })

  test("does not treat directory arguments as command words", () => {
    expect(isBareCommandWord(".")).toBe(false)
    expect(isBareCommandWord("..")).toBe(false)
    expect(isBareCommandWord("~")).toBe(false)
    expect(isBareCommandWord("~/projects/foo")).toBe(false)
    expect(isBareCommandWord("relative/dir")).toBe(false)
    expect(isBareCommandWord("./dir")).toBe(false)
    expect(isBareCommandWord("/abs/path")).toBe(false)
    expect(isBareCommandWord("C:\\projects\\foo")).toBe(false)
    expect(isBareCommandWord("dir\\win")).toBe(false)
    expect(isBareCommandWord("   ")).toBe(false)
  })
})

describe("unknownProjectError (#414)", () => {
  const commands = ["agent", "completion", "models", "run", "session"]

  test("flags a bare word that does not exist as a path", () => {
    const error = unknownProjectError("config", false, commands)
    expect(error).toContain("Unknown command: config")
    expect(error).toContain("models")
    expect(error).toContain("session")
  })

  test("flags typo-style command words", () => {
    expect(unknownProjectError("typo-cmd", false, commands)).toContain("Unknown command: typo-cmd")
  })

  test("leaves existing paths alone", () => {
    expect(unknownProjectError("config", true, commands)).toBeUndefined()
    expect(unknownProjectError(".", true, commands)).toBeUndefined()
  })

  test("leaves non-existent directory-looking paths on the chdir error path", () => {
    expect(unknownProjectError("missing/deep/path", false, commands)).toBeUndefined()
    expect(unknownProjectError("/missing/abs", false, commands)).toBeUndefined()
    expect(unknownProjectError("~/missing", false, commands)).toBeUndefined()
  })

  test("falls back to a --help hint when no command list is registered", () => {
    expect(formatUnknownCommandError("config", [])).toContain("ax-code --help")
  })
})

describe("knownCommands registry", () => {
  test("dedupes, sorts, and returns the registered set", () => {
    setKnownCommands(["run", "models", "run"])
    expect(knownCommands()).toEqual(["models", "run"])
    setKnownCommands([])
  })
})

describe("unknown-command wiring guardrails (#414)", () => {
  test("default command validates the project positional before chdir and exits non-zero", () => {
    const idx = THREAD_SRC.indexOf("unknownProjectError(args.project")
    expect(idx).toBeGreaterThan(-1)
    const block = THREAD_SRC.slice(idx, THREAD_SRC.indexOf("return", idx) + "return".length)
    expect(block).toContain("process.exitCode = 1")
    // The validation must run before the TUI launcher changes directory.
    expect(THREAD_SRC.indexOf("process.chdir(next)")).toBeGreaterThan(idx)
  })

  test("boot registers the known command list derived from the command table", () => {
    expect(BOOT_SRC).toContain("setKnownCommands(")
    // Hidden/internal commands must not be advertised.
    expect(BOOT_SRC).toContain("describe === false")
    // The default command itself must not appear in the list.
    expect(BOOT_SRC).toContain('name === "$0"')
  })
})
