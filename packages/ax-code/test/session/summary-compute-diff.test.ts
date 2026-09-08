import { afterEach, expect, test, vi } from "vitest"
import { Snapshot } from "../../src/snapshot"
import { SessionSummary } from "../../src/session/summary"
import type { MessageV2 } from "../../src/session/message-v2"

afterEach(() => {
  vi.restoreAllMocks()
})

function messages(from: string, to: string): MessageV2.WithParts[] {
  return [
    { info: { id: "msg_user" }, parts: [{ type: "step-start", snapshot: from }] },
    { info: { id: "msg_assistant" }, parts: [{ type: "step-finish", snapshot: to }] },
  ] as unknown as MessageV2.WithParts[]
}

test("computeDiff reuses the result for an identical content-addressed pair", async () => {
  const from = "a".repeat(40)
  const to = "b".repeat(40)
  const diffs: Snapshot.FileDiff[] = [{ file: "f.txt", before: "", after: "x\n", additions: 1, deletions: 0 }]
  const diffFull = vi.spyOn(Snapshot, "diffFull").mockResolvedValue(diffs)

  expect(await SessionSummary.computeDiff({ messages: messages(from, to) })).toEqual(diffs)
  expect(await SessionSummary.computeDiff({ messages: messages(from, to) })).toEqual(diffs)
  expect(diffFull).toHaveBeenCalledTimes(1)

  // A different (from,to) pair must still recompute.
  await SessionSummary.computeDiff({ messages: messages(from, "c".repeat(40)) })
  expect(diffFull).toHaveBeenCalledTimes(2)
})

test("computeDiff cache is bounded and evicts the oldest pair", async () => {
  const diffFull = vi.spyOn(Snapshot, "diffFull").mockResolvedValue([])
  const from = "a".repeat(40)
  const first = "0".repeat(40)
  for (let i = 0; i < 12; i++) {
    const to = i.toString(16).padStart(40, "0")
    await SessionSummary.computeDiff({ messages: messages(from, to) })
  }
  expect(diffFull).toHaveBeenCalledTimes(12)
  // The first pair was evicted by the bounded cache, so it recomputes.
  await SessionSummary.computeDiff({ messages: messages(from, first) })
  expect(diffFull).toHaveBeenCalledTimes(13)
})
