import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { UI } from "../../src/cli/ui"
import { tmpdir } from "../fixture/fixture"

const { runNativeWiki } = vi.hoisted(() => ({
  runNativeWiki: vi.fn(async () => ({ generatedPages: [], unchangedPages: [], removedPages: [], failedPages: [] })),
}))

vi.mock("../../src/wiki/native", () => ({ runNativeWiki }))
vi.mock("../../src/wiki/visualization", () => {
  throw new Error("Wiki generation must not load visualization")
})
vi.mock("../../src/cli/bootstrap", () => ({
  bootstrap: vi.fn(async (directory: string, fn: () => Promise<unknown>) => Instance.provide({ directory, fn })),
  bootstrapReadonly: vi.fn(() => {
    throw new Error("Wiki generation requires the full runtime")
  }),
}))

const wiki = await import("../../src/cli/cmd/wiki")

afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

type Handler = (args: Record<string, unknown>) => Promise<void>

test.each([
  ["generate", wiki.WikiGenerateCommand],
  ["update", wiki.WikiUpdateCommand],
])("%s loads the generator inside the full bootstrap", async (action, command) => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(UI, "println").mockImplementation(() => undefined)
  await (command.handler as Handler)({
    _: [],
    $0: "ax-code",
    directory: tmp.path,
    model: "test/model",
    force: true,
    quiet: true,
    "skip-agents": true,
  })
  expect(runNativeWiki).toHaveBeenCalledExactlyOnceWith({
    root: tmp.path,
    action,
    dir: ".ax-wiki",
    model: "test/model",
    force: true,
    onProgress: undefined,
  })
})
