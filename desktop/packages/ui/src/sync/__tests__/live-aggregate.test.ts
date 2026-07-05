import { describe, expect, it } from "vitest"
import type { Session } from "@ax-code/sdk/v2"
import type { SessionStatus } from "@ax-code/sdk/v2/client"

import {
  aggregateLiveSessions,
  aggregateLiveSessionStatuses,
  areStatusMapsEquivalent,
  findLiveSession,
  findLiveSessionStatus,
} from "../live-aggregate.ts"
import { deriveLiveActiveNowSessions } from "../../components/session/sidebar/activitySections.ts"

type SessionOverride = Partial<Omit<Session, "id" | "time">> & {
  time?: Partial<NonNullable<Session["time"]>>
}

type LiveStateTestSlice = {
  session: Session[]
  session_status: Record<string, SessionStatus>
}

const session = (id: string, directory: string, updated: number, extra: SessionOverride = {}): Session => {
  const { time, ...rest } = extra

  return {
    id,
    slug: id,
    projectID: "project-1",
    directory,
    title: `${id}-title`,
    version: "0.0.0-test",
    time: { created: updated - 1, updated, ...time },
    ...rest,
  }
}

const liveState = (sessions: Session[], statuses: Record<string, SessionStatus> = {}): LiveStateTestSlice => ({
  session: sessions,
  session_status: statuses,
})

describe("live aggregate", () => {
  it("prefers the freshest live session snapshot across child stores", () => {
    const states = [
      liveState([session("ses-1", "/a", 10, { title: "old" })]),
      liveState([session("ses-1", "/a", 25, { title: "new" }), session("ses-2", "/b", 20)]),
    ]

    const sessions = aggregateLiveSessions(states)
    expect(sessions.map((item) => `${item.id}:${item.title}`)).toEqual(["ses-1:new", "ses-2:ses-2-title"])
    expect(findLiveSession(states, "ses-1")?.title).toBe("new")
  })

  it("prefers busy/retry statuses over stale idle snapshots", () => {
    const states = [
      liveState([], {
        "ses-1": { type: "idle" },
        "ses-2": { type: "idle" },
      }),
      liveState([], {
        "ses-1": { type: "busy" },
        "ses-2": { type: "retry", message: "retrying", attempt: 1, next: 100 },
      }),
    ]

    const statuses = aggregateLiveSessionStatuses(states)
    expect(statuses["ses-1"]?.type).toBe("busy")
    expect(statuses["ses-2"]?.type).toBe("retry")
    expect(findLiveSessionStatus(states, "ses-2")?.type).toBe("retry")
  })

  it("lets a fresher idle snapshot override a stale busy status", () => {
    const states = [
      liveState([session("ses-1", "/a", 10)], {
        "ses-1": { type: "busy" },
      }),
      liveState([session("ses-1", "/a", 30)], {
        "ses-1": { type: "idle" },
      }),
    ]

    const statuses = aggregateLiveSessionStatuses(states)
    expect(statuses["ses-1"]?.type).toBe("idle")
    expect(findLiveSessionStatus(states, "ses-1")?.type).toBe("idle")
  })

  it("detects retry metadata changes in status maps", () => {
    const retryStatus: SessionStatus = { type: "retry", message: "retrying|server|message", attempt: 1, next: 100 }

    expect(areStatusMapsEquivalent({ "ses-1": retryStatus }, { "ses-1": { ...retryStatus } })).toBe(true)

    expect(
      areStatusMapsEquivalent({ "ses-1": retryStatus }, { "ses-1": { ...retryStatus, attempt: 2, next: 200 } }),
    ).toBe(false)
  })

  it("derives active-now sessions from live statuses instead of persisted history", () => {
    const sessions = [
      session("ses-1", "/a", 20),
      session("ses-2", "/b", 30),
      session("ses-3", "/c", 10, { time: { created: 9, updated: 10, archived: 50 } }),
      session("ses-4", "/d", 40, { parentID: "ses-parent" }),
    ]

    const activeNow = deriveLiveActiveNowSessions(sessions, {
      "ses-1": { type: "busy" },
      "ses-2": { type: "retry", message: "retrying", attempt: 1, next: 100 },
      "ses-3": { type: "busy" },
      "ses-4": { type: "busy" },
    })

    expect(activeNow.map((item) => item.id)).toEqual(["ses-2", "ses-1"])
  })
})
