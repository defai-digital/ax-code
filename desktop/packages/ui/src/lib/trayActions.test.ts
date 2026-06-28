import { describe, expect, test } from "vitest"

import { createTrayPermissionActionDeduper, normalizeTrayPermissionAction } from "./trayActions"

describe("tray permission actions", () => {
  test("normalizes valid permission response actions", () => {
    expect(
      normalizeTrayPermissionAction({
        type: "respond-permission",
        sessionId: " session-a ",
        id: " permission-1 ",
        response: "once",
      }),
    ).toEqual({
      type: "respond-permission",
      sessionId: "session-a",
      id: "permission-1",
      response: "once",
    })
  })

  test("rejects malformed permission response actions", () => {
    expect(normalizeTrayPermissionAction(null)).toBeNull()
    expect(normalizeTrayPermissionAction({ type: "focus-session" })).toBeNull()
    expect(normalizeTrayPermissionAction({ type: "respond-permission", sessionId: "", id: "p", response: "once" })).toBeNull()
    expect(
      normalizeTrayPermissionAction({
        type: "respond-permission",
        sessionId: "s",
        id: "p",
        response: "invalid",
      }),
    ).toBeNull()
  })

  test("suppresses duplicate same-action deliveries within the duplicate window", () => {
    let now = 1000
    const dedupe = createTrayPermissionActionDeduper({ duplicateWindowMs: 500, now: () => now })
    const action = {
      type: "respond-permission",
      sessionId: "session-a",
      id: "permission-1",
      response: "always",
    }

    expect(dedupe(action)).toEqual(action)
    now += 10
    expect(dedupe(action)).toBeNull()

    now += 10
    expect(dedupe({ ...action, response: "reject" })).toEqual({ ...action, response: "reject" })

    now += 600
    expect(dedupe(action)).toEqual(action)
  })

  test("suppresses duplicate deliveries even when another action arrives between them", () => {
    let now = 1000
    const dedupe = createTrayPermissionActionDeduper({ duplicateWindowMs: 500, now: () => now })
    const firstAction = {
      type: "respond-permission",
      sessionId: "session-a",
      id: "permission-1",
      response: "once",
    }
    const secondAction = {
      type: "respond-permission",
      sessionId: "session-a",
      id: "permission-2",
      response: "always",
    }

    expect(dedupe(firstAction)).toEqual(firstAction)
    now += 10
    expect(dedupe(secondAction)).toEqual(secondAction)
    now += 10
    expect(dedupe(firstAction)).toBeNull()
  })
})
