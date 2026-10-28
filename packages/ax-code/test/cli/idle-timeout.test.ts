import { expect, test } from "vitest"
import yargs from "yargs"
import { headlessBackendOptions } from "../../src/cli/cmd/headless-shared"

async function parse(argv: string[]) {
  const failures: string[] = []
  const args = await headlessBackendOptions(yargs(argv))
    .fail((message) => {
      failures.push(message)
    })
    .exitProcess(false)
    .parseAsync()
  return { args, failures }
}

test("a mistyped --idle-timeout-ms is a usage error, not a disabled timeout", async () => {
  for (const value of ["10min", "abc", "1e400"]) {
    const { failures } = await parse(["--idle-timeout-ms", value])
    expect(failures.join("\n")).toContain("--idle-timeout-ms")
  }
})

test("--idle-timeout-ms keeps 0 as the explicit off switch and the default otherwise", async () => {
  expect((await parse(["--idle-timeout-ms", "0"])).args["idle-timeout-ms"]).toBe(0)
  expect((await parse([])).args["idle-timeout-ms"]).toBe(600_000)
})
