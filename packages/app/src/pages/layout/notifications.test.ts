import { describe, expect, test } from "bun:test"
import {
  relatedSessionAlertKeys,
  sessionAlertContent,
  sessionAlertHref,
  sessionAlertKey,
  shouldAlertSession,
  shouldSkipSessionAlert,
} from "./notifications"

describe("layout notifications helpers", () => {
  test("builds stable alert keys and hrefs", () => {
    expect(sessionAlertKey("/tmp/app", "s1")).toBe("/tmp/app:s1")
    expect(sessionAlertHref("/tmp/app", "s1")).toContain("/session/s1")
  })

  test("builds permission and question alert content", () => {
    const t = (key: string, vars?: Record<string, string | number | boolean>) =>
      vars ? `${key}:${vars.sessionTitle}:${vars.projectName}` : key

    expect(sessionAlertContent("permission.asked", t, "Session", "Project")).toEqual({
      title: "notification.permission.title",
      description: "notification.permission.description:Session:Project",
      icon: "checklist",
    })
    expect(sessionAlertContent("question.asked", t, "Session", "Project")).toEqual({
      title: "notification.question.title",
      description: "notification.question.description:Session:Project",
      icon: "bubble-5",
    })
  })

  test("applies alert cooldown", () => {
    expect(shouldAlertSession(10_000, 4_000)).toBe(true)
    expect(shouldAlertSession(8_000, 4_000)).toBe(false)
  })

  test("skips alerts for the active session and its child session", () => {
    expect(
      shouldSkipSessionAlert({
        currentDir: "/tmp/app",
        currentSession: "s1",
        directory: "/tmp/app",
        sessionID: "s1",
      }),
    ).toBe(true)

    expect(
      shouldSkipSessionAlert({
        currentDir: "/tmp/app",
        currentSession: "s1",
        directory: "/tmp/app",
        sessionID: "s2",
        parentID: "s1",
      }),
    ).toBe(true)

    expect(
      shouldSkipSessionAlert({
        currentDir: "/tmp/app",
        currentSession: "s1",
        directory: "/tmp/other",
        sessionID: "s2",
        parentID: "s1",
      }),
    ).toBe(false)
  })

  test("collects alert keys for current and child sessions", () => {
    expect(
      relatedSessionAlertKeys("/tmp/app", "s1", [
        { id: "s1" },
        { id: "s2", parentID: "s1" },
        { id: "s3", parentID: "other" },
      ]),
    ).toEqual(["/tmp/app:s1", "/tmp/app:s2"])
  })
})
