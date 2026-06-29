import { describe, expect, test } from "vitest"
import { isCurrentProjectOperationTarget, type ProjectOperationTarget } from "./projectOperationTarget"

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
