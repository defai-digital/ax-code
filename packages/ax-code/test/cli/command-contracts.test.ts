import { afterEach, expect, test, vi } from "vitest"
import { cli, commandSections, commandName } from "../../src/cli/boot"
import { cli as nodeCli } from "../../src/cli/boot-node"
import { createAxCodeCli } from "../../src/cli/boot-shared"
import { ReleaseNotesCommand } from "../../src/cli/cmd/release-notes"
import { ProvidersAuthCommand } from "../../src/cli/cmd/providers-auth"
import { Installation } from "../../src/installation"

vi.mock("../../src/cli/bootstrap/env", () => ({ init: vi.fn() }))
vi.mock("../../src/cli/bootstrap/migrate", () => ({ migrate: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

async function usage(argv: string[], parser = cli) {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("test exit")
  })
  await expect(Promise.resolve().then(() => parser(argv).parseAsync())).rejects.toThrow("test exit")
  expect(exit).toHaveBeenCalledWith(1)
  return {
    stdout: stdout.mock.calls.map(([text]) => String(text)).join(""),
    stderr: stderr.mock.calls.map(([text]) => String(text)).join(""),
  }
}

test.each([
  ["task", "list", "--json", "--not-a-flag"],
  ["--json=true", "session", "list", "--not-a-flag"],
  ["session", "list", "--json=true", "--not-a-flag"],
  ["session", "branch", "--json"],
])("JSON usage errors are a single document: %j", async (...argv) => {
  const output = await usage(argv)
  expect(JSON.parse(output.stderr)).toMatchObject({ error: { code: "usage", message: expect.any(String) } })
  expect(output.stdout).toBe("")
  expect(output.stderr).not.toContain("Options:")
})

test.each([
  ["session", "list", "--json=false", "--not-a-flag"],
  ["session", "list", "--no-json", "--not-a-flag"],
  ["session", "list", "--json", "false", "--not-a-flag"],
  ["session", "list", "--not-a-flag", "--", "--json"],
  ["run", "--json", "--not-a-flag"],
])("disabled, positional or unsupported JSON flags do not enable machine mode: %j", async (...argv) => {
  const output = await usage(argv)
  expect(output.stdout).toBe("")
})

test("run keeps its existing single NDJSON usage event", async () => {
  const output = await usage(["run", "--format", "json", "--not-a-flag"])
  expect(JSON.parse(output.stdout)).toMatchObject({ type: "error", error: { code: "usage" } })
})

test("missing --prompt-file value fails at parsing instead of waiting on stdin", async () => {
  const output = await usage(["run", "--format", "json", "--prompt-file"])
  expect(JSON.parse(output.stdout)).toMatchObject({
    type: "error",
    error: { code: "usage", message: "Not enough arguments following: prompt-file" },
  })
})

test("the slim Node CLI uses the same JSON usage contract", async () => {
  const output = await usage(["doctor", "--json", "--not-a-flag"], nodeCli)
  expect(JSON.parse(output.stderr)).toMatchObject({ error: { code: "usage" } })
})

test.each(["--target-version=7.27.0", "--target-version"])(
  "release notes target does not conflict with global version: %s",
  async (flag) => {
    const handler = vi.fn()
    const args = ["release-notes", flag, ...(flag.includes("=") ? [] : ["7.27.0"]), "--json"]
    await createAxCodeCli(args, [{ ...ReleaseNotesCommand, handler }])
      .cli.strict()
      .parseAsync()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ "target-version": "7.27.0", json: true }))
  },
)

test.each(["--version", "-v"])("global version remains available: %s", async (flag) => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {})
  const handler = vi.fn()
  await createAxCodeCli([flag], [{ ...ReleaseNotesCommand, handler }])
    .cli.exitProcess(false)
    .parseAsync()
  expect(output).toHaveBeenCalledWith(Installation.VERSION)
  expect(handler).not.toHaveBeenCalled()
})

test.each([
  ["import", "--input-file", "input-file"],
  ["export", "--output-file", "output-file"],
  ["export", "-o", "output-file"],
])("auth %s uses distinct transfer paths", async (action, flag, key) => {
  const handler = vi.fn()
  await createAxCodeCli(["auth", action, flag, "refs.json"], [{ ...ProvidersAuthCommand, handler }])
    .cli.strict()
    .parseAsync()
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ [key]: "refs.json" }))
})

test("every visible command belongs to exactly one rendered help section", async () => {
  const names = commandSections.flatMap((section) => section.commands.map((command) => commandName(command)))
  expect(new Set(names).size).toBe(names.length)
  const help = await cli([]).getHelp()
  for (const section of commandSections) {
    const group = help.slice(help.indexOf(section.title)).split(/\n\n/)[0]!
    for (const command of section.commands) expect(group).toContain(`ax-code ${command.command}`)
  }
  for (const name of ["goal", "snapshot", "watch", "release-notes"]) expect(names).toContain(name)
})

test.each([
  [["capability", "list"], "--path", "--file"],
  [["providers", "auth", "import"], "--input-file", "--file"],
  [["providers", "auth", "export"], "--output-file", "--file"],
  [["release-notes"], "--target-version", "--file"],
] as const)("help advertises distinct file and version selectors: %j", async (argv, present, absent) => {
  const help = await cli([...argv]).getHelp()
  expect(help).toContain(present)
  expect(help).not.toMatch(new RegExp(`${absent}\\s`))
})

test.each(["list", "project-status", "clear-project", "backup-project", "delete", "prune"])(
  "session %s exposes its project selector",
  async (command) => {
    const help = await cli(["session", command]).getHelp()
    expect(help).toContain("--dir")
  },
)
