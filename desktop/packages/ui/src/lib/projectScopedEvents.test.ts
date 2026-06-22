import { describe, expect, test } from "vitest"
import { parseProjectScopedEvent, projectScopedEventMatchesProject } from "./projectScopedEvents"

describe("project scoped events", () => {
  test("parses and trims project ids from custom event details", () => {
    expect(
      parseProjectScopedEvent(
        new CustomEvent("refresh", {
          detail: { projectId: " project-1 " },
        }),
      ),
    ).toEqual({ projectId: "project-1" })
  })

  test("treats missing or invalid project ids as global refreshes", () => {
    expect(parseProjectScopedEvent(new Event("refresh"))).toEqual({ projectId: null })
    expect(
      parseProjectScopedEvent(
        new CustomEvent("refresh", {
          detail: null,
        }),
      ),
    ).toEqual({ projectId: null })
    expect(
      parseProjectScopedEvent(
        new CustomEvent("refresh", {
          detail: { projectId: " " },
        }),
      ),
    ).toEqual({ projectId: null })
    expect(
      parseProjectScopedEvent(
        new CustomEvent("refresh", {
          detail: { projectId: 12 },
        }),
      ),
    ).toEqual({ projectId: null })
  })

  test("matches global and same-project refresh events", () => {
    expect(projectScopedEventMatchesProject(new Event("refresh"), "project-1")).toBe(true)
    expect(
      projectScopedEventMatchesProject(
        new CustomEvent("refresh", {
          detail: { projectId: " project-1 " },
        }),
        "project-1",
      ),
    ).toBe(true)
  })

  test("rejects refresh events for other projects", () => {
    expect(
      projectScopedEventMatchesProject(
        new CustomEvent("refresh", {
          detail: { projectId: "project-2" },
        }),
        "project-1",
      ),
    ).toBe(false)
  })
})
