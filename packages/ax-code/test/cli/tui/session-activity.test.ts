import { describe, expect, test } from "vitest"
import { createSessionActivityIndex, knownAttentionRequestCount, knownAttentionRequests } from "../../../src/cli/tui/util/session-activity"

const sessions = [{ id: "root" }, { id: "child", parentID: "root" }, { id: "deep", parentID: "child" }, { id: "other" }]

describe("session activity", () => {
  test("asks take precedence over retry and busy at any depth", () => {
    const index = createSessionActivityIndex({
      sessions,
      statuses: { root: { type: "busy" }, child: { type: "retry" } },
      permissions: { deep: [{ id: "p", sessionID: "deep" }] },
      questions: { child: [{ id: "q", sessionID: "child" }] },
    })
    expect(index.get("root").label).toBe("Approval and question pending")
    expect(index.get("root").attention).toBe(true)
    expect(index.get("other").label).toBeUndefined()
  })

  test.each([
    ["busy", "Working"],
    ["retry", "Retrying"],
    ["idle", undefined],
  ])("%s in a grandchild", (type, label) => {
    const index = createSessionActivityIndex({
      sessions,
      statuses: { deep: { type: type! } },
      permissions: {},
      questions: {},
    })
    expect(index.get("root").label).toBe(label)
  })

  test("missing state never creates an idle badge", () => {
    const index = createSessionActivityIndex({ sessions, statuses: {}, permissions: {}, questions: {} })
    expect(index.get("root").label).toBeUndefined()
    expect(index.get("root").working).toBe(false)
  })

  test("request references preserve kind and target, omit payloads and deduplicate", () => {
    const request = { id: "same", sessionID: "missing-session", metadata: { secret: "private" } }
    expect(knownAttentionRequests({ one: [request], two: [request] }, { three: [request] })).toEqual([
      { id: "same", sessionID: "missing-session", kind: "approval" },
      { id: "same", sessionID: "missing-session", kind: "question" },
    ])
  })
})

test("knownAttentionRequestCount matches the sorted list length", () => {
  const permissions = {
    a: [{ id: "p1", sessionID: "s1" }, { id: "p2", sessionID: "s2" }],
    b: [{ id: "p1", sessionID: "s1" }],
  }
  const questions = { a: [{ id: "q1", sessionID: "s1" }], c: undefined }
  expect(knownAttentionRequestCount(permissions, questions)).toBe(knownAttentionRequests(permissions, questions).length)
  expect(knownAttentionRequestCount({}, {})).toBe(0)
})
