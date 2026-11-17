import { expect, test, vi } from "vitest"
import yargs from "yargs"
import { headlessBackendOptions } from "../../src/cli/cmd/headless-options"

// Goal registration must be able to load shared options without evaluating
// the backend's bootstrap graph.
vi.mock("../../src/cli/bootstrap", () => {
  throw new Error("Headless option registration must not load backend bootstrap")
})

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

test("shared headless options preserve command-specific arguments and backend settings", async () => {
  const args = await headlessBackendOptions(
    yargs([
      "--session",
      "fixture-session",
      "--attach",
      "http://localhost:4096",
      "--password",
      "fixture-password",
      "--no-autonomous",
      "--event-log",
      "events.jsonl",
    ]).option("session", { type: "string" }),
  )
    .exitProcess(false)
    .parseAsync()
  expect(args).toMatchObject({
    session: "fixture-session",
    attach: "http://localhost:4096",
    password: "fixture-password",
    autonomous: false,
    "event-log": "events.jsonl",
    "idle-timeout-ms": 600_000,
  })
  expect((await parse([])).args.autonomous).toBe(true)
})
