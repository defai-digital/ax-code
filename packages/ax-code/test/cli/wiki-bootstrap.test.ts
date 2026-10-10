import { beforeEach, describe, expect, test, vi } from "vitest"

const calls: string[] = []

vi.mock("../../src/cli/bootstrap", () => ({
  bootstrap: vi.fn(async () => {
    calls.push("full")
  }),
  bootstrapReadonly: vi.fn(async () => {
    calls.push("readonly")
  }),
}))

const wiki = await import("../../src/cli/cmd/wiki")

type Handler = (args: Record<string, unknown>) => Promise<void> | void

async function run(command: { handler?: unknown }, args: Record<string, unknown> = {}) {
  calls.length = 0
  await (command.handler as Handler)({ _: [], $0: "ax-code", ...args })
  return [...calls]
}

describe("wiki subcommand bootstrap", () => {
  beforeEach(() => {
    calls.length = 0
  })

  // Read-only subcommands must not start providers/LSP/watchers: their open
  // handles hold the process until the 2 s forced-exit grace expires.
  test.each([
    ["status", wiki.WikiStatusCommand, {}],
    ["doctor", wiki.WikiDoctorCommand, {}],
    ["plan", wiki.WikiPlanCommand, {}],
    ["lint", wiki.WikiLintCommand, {}],
    ["cards", wiki.WikiCardsCommand, {}],
    ["related", wiki.WikiRelatedCommand, { symbol: "X" }],
    ["ensure-agents", wiki.WikiEnsureAgentsCommand, {}],
  ])("%s uses the read-only bootstrap", async (_name, command, args) => {
    expect(await run(command, args)).toEqual(["readonly"])
  })

  // Generation talks to the model provider, so it keeps the full bootstrap.
  test.each([
    ["generate", wiki.WikiGenerateCommand],
    ["update", wiki.WikiUpdateCommand],
  ])("%s keeps the full bootstrap", async (_name, command) => {
    expect(await run(command)).toEqual(["full"])
  })
})
