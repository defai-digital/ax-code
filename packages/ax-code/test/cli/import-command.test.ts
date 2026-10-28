import { afterEach, expect, test, vi } from "vitest"
import yargs from "yargs"
import { ImportCommand, ImportSessionsCommand } from "../../src/cli/cmd/import"

afterEach(() => {
  process.exitCode = undefined
  vi.restoreAllMocks()
})

test("`import sessions` reaches the subcommand instead of failing on the parent's file argument", async () => {
  const handler = vi.spyOn(ImportSessionsCommand, "handler").mockImplementation(async () => {})
  const failures: string[] = []
  await yargs(["import", "sessions"])
    .command(ImportCommand)
    .fail((message) => {
      failures.push(message)
    })
    .exitProcess(false)
    .parseAsync()

  expect(failures).toEqual([])
  expect(handler).toHaveBeenCalledTimes(1)
})
