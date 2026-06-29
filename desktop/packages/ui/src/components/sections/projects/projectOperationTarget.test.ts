import { describe, expect, test } from "vitest"
import {
  isCurrentProjectOperationTarget,
  ProjectOperationSequence,
  type ProjectOperationTarget,
} from "./projectOperationTarget"

describe("isCurrentProjectOperationTarget", () => {
  const project: ProjectOperationTarget = { id: "project-a", path: "/repo/a" }

  test("accepts the same project id and path", () => {
    expect(isCurrentProjectOperationTarget(project, { id: "project-a", path: "/repo/a" })).toBe(true)
  })

  test("rejects a different selected project id", () => {
    expect(isCurrentProjectOperationTarget(project, { id: "project-b", path: "/repo/a" })).toBe(false)
  })

  test("rejects a different selected project path", () => {
    expect(isCurrentProjectOperationTarget(project, { id: "project-a", path: "/repo/b" })).toBe(false)
  })

  test("rejects missing operation targets", () => {
    expect(isCurrentProjectOperationTarget(null, project)).toBe(false)
    expect(isCurrentProjectOperationTarget(project, null)).toBe(false)
  })
})

describe("ProjectOperationSequence", () => {
  test("only treats the latest operation token as current", () => {
    const sequence = new ProjectOperationSequence()

    const stale = sequence.begin()
    const latest = sequence.begin()

    expect(sequence.isCurrent(stale)).toBe(false)
    expect(sequence.isCurrent(latest)).toBe(true)
  })

  test("does not let stale completion clear a newer operation", () => {
    const sequence = new ProjectOperationSequence()

    const stale = sequence.begin()
    const latest = sequence.begin()

    expect(sequence.complete(stale)).toBe(false)
    expect(sequence.isCurrent(latest)).toBe(true)
    expect(sequence.complete(latest)).toBe(true)
    expect(sequence.isCurrent(latest)).toBe(false)
  })
})
