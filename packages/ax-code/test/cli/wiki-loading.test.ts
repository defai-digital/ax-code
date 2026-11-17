import { writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { UI } from "../../src/cli/ui"
import { tmpdir } from "../fixture/fixture"

vi.mock("../../src/wiki/native", () => {
  throw new Error("Wiki inspection must not load model generation")
})

vi.mock("../../src/wiki/visualization", () => {
  throw new Error("Wiki inspection must not load visualization")
})

vi.mock("../../src/cli/bootstrap", () => ({
  bootstrap: vi.fn(() => {
    throw new Error("Wiki inspection must not start the full runtime")
  }),
  bootstrapReadonly: vi.fn(async (directory: string, fn: () => Promise<unknown>) =>
    Instance.provide({ directory, fn }),
  ),
}))

const wiki = await import("../../src/cli/cmd/wiki")
const originalExitCode = process.exitCode

afterEach(async () => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

type Handler = (args: Record<string, unknown>) => Promise<void>

test.each([
  ["status", wiki.WikiStatusCommand, {}],
  ["doctor", wiki.WikiDoctorCommand, {}],
  ["plan", wiki.WikiPlanCommand, {}],
  ["lint", wiki.WikiLintCommand, {}],
  ["cards", wiki.WikiCardsCommand, {}],
  ["related", wiki.WikiRelatedCommand, { symbol: "Widget" }],
  ["ensure-agents", wiki.WikiEnsureAgentsCommand, { "dry-run": true, force: true }],
])("%s executes without generation or visualization modules", async (name, command, args) => {
  await using tmp = await tmpdir({ git: true })
  await writeFile(path.join(tmp.path, "index.ts"), "export class Widget {}\n")
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
  const print = vi.spyOn(UI, "println").mockImplementation(() => undefined)

  await (command.handler as Handler)({ _: [], $0: "ax-code", directory: tmp.path, json: true, ...args })

  if (name === "status") expect(log).toHaveBeenCalledWith(expect.stringContaining('"exists": false'))
  else if (name === "plan") expect(log).toHaveBeenCalledWith(expect.stringContaining('"sourceCount": 1'))
  else if (name === "ensure-agents") expect(print).toHaveBeenCalledWith(expect.stringContaining("AX-WIKI"))
  else expect(log).toHaveBeenCalled()
})
