import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { SessionID } from "./schema"
import z from "zod"

export namespace SessionStatus {
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
        step: z.number().optional(),
        maxSteps: z.number().optional(),
        startedAt: z.number().optional(),
        lastActivityAt: z.number().optional(),
        activeTool: z.string().optional(),
        toolCallID: z.string().optional(),
        waitState: z.enum(["llm", "tool"]).optional(),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: SessionID.zod,
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  const state = Instance.state(() => new Map<SessionID, Info>())
  const MAX_SESSIONS = 256

  export async function get(sessionID: SessionID) {
    return state().get(sessionID) ?? { type: "idle" as const }
  }

  export async function list() {
    return new Map(state())
  }

  export async function set(sessionID: SessionID, status: Info) {
    const data = state()

    // Update state before publishing events so subscribers see current state.
    if (status.type === "idle") {
      data.delete(sessionID)
      Bus.publishDetached(Event.Status, { sessionID, status })
      Bus.publishDetached(Event.Idle, { sessionID })
      return
    }

    data.set(sessionID, status)
    trimOldStatusEntries(data, sessionID)
    Bus.publishDetached(Event.Status, { sessionID, status })
  }

  function trimOldStatusEntries(data: Map<SessionID, Info>, protectedSessionID: SessionID) {
    while (data.size > MAX_SESSIONS) {
      const oldest = oldestStatusEntry(data, protectedSessionID)
      if (!oldest) break
      data.delete(oldest)
    }
  }

  function oldestStatusEntry(data: Map<SessionID, Info>, protectedSessionID: SessionID) {
    let oldestID: SessionID | undefined
    let oldestTime = Infinity

    for (const [sessionID, status] of data) {
      if (sessionID === protectedSessionID) continue
      const time = statusActivityTime(status)
      if (time >= oldestTime) continue
      oldestID = sessionID
      oldestTime = time
    }

    return oldestID
  }

  function statusActivityTime(status: Info) {
    switch (status.type) {
      case "busy":
        return status.lastActivityAt ?? status.startedAt ?? 0
      case "retry":
        return status.next
      case "idle":
        return 0
    }
  }

  /**
   * Drop the in-process status entry without publishing status / idle events.
   * Use from teardown paths (e.g. `Session.remove`) where the session is being
   * destroyed: subscribers receive a `session.deleted` event instead, and the
   * usual "session went idle" notification would be a false positive (it never
   * went idle — it ceased to exist).
   */
  export function clear(sessionID: SessionID) {
    state().delete(sessionID)
  }
}
