import { afterEach, expect, test, vi } from "vitest"
import { MemoryCurateCommand } from "../../src/cli/cmd/memory"
import { Curation } from "../../src/memory/curate"

afterEach(() => vi.restoreAllMocks())

const record = {
  id: "mem-project-feedback-stale-rule",
  target: "memory",
  kind: "feedback",
  name: "stale-rule",
} as never

async function undo(json: boolean) {
  vi.spyOn(Curation, "undo").mockResolvedValue(record)
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  await MemoryCurateCommand.handler({ undo: "mem-project-feedback-stale-rule", json, $0: "ax-code", _: [] } as never)
  return log.mock.calls.map((call) => call.join(" ")).join("\n")
}

test("curate --undo --json prints the restored record as JSON", async () => {
  expect(JSON.parse(await undo(true))).toMatchObject({ kind: "feedback", name: "stale-rule" })
})

test("curate --undo names the restored memory as kind/name", async () => {
  expect(await undo(false)).toContain("feedback/stale-rule")
})
