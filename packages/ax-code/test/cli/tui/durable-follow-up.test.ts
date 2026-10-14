import { createStore } from "solid-js/store"
import { describe, expect, test } from "vitest"
import {
  cancelFollowUpEdit,
  durableFollowUps,
  followUpBody,
  followUpLabel,
  followUpStatus,
  isTextFollowUp,
  mergeFollowUpSnapshot,
  pauseFollowUpForEdit,
  type FollowUpSdk,
} from "../../../src/cli/tui/component/prompt/durable-follow-up"

function row(id: string, status = "queued") {
  return {
    id,
    kind: "followup",
    sessionID: "ses_one",
    status,
    title: id,
    position: 1,
    time: { created: 1, updated: 1 },
    payload: {
      body: {
        parts: [
          { type: "text", text: "Review" },
          { type: "file", url: "data:text/plain,example", mime: "text/plain" },
        ],
        agent: "build",
        model: { providerID: "gateway", modelID: "model" },
        variant: "high",
      },
    },
  }
}

/** A command_async row as the busy-session route enqueues it (server title is the bare command line). */
function commandRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "command",
    sessionID: "ses_one",
    status: "waiting_for_idle",
    title: "goal ship the release",
    position: 2,
    time: { created: 2, updated: 2 },
    payload: {
      body: {
        command: "goal",
        arguments: "ship the release",
        agent: "build",
        model: { providerID: "gateway", modelID: "model" },
      },
    },
    ...overrides,
  }
}

describe("durable follow-up projection", () => {
  test("accepts Solid store payloads without treating internal symbols as JSON fields", () => {
    const item = row("reactive")
    Object.defineProperty(item.payload, Symbol("store-node"), { value: {}, enumerable: true })
    const [state, setState] = createStore({ items: [item] })
    expect(durableFollowUps(state.items, "ses_one").map((item) => item.id)).toEqual(["reactive"])
    setState("items", 0, "status", "paused")
    expect(durableFollowUps(state.items, "ses_one")[0].status).toBe("paused")
  })
  test("history explicitly includes completed and cancelled work", () => {
    expect(
      durableFollowUps([row("a", "completed"), row("b", "cancelled")], "ses_one", { includeHistory: true }),
    ).toHaveLength(2)
  })
  test("separates sessions and task kinds while retaining paused and failed work", () => {
    expect(
      durableFollowUps(
        [
          row("a"),
          row("b", "paused"),
          row("c", "failed"),
          row("d", "completed"),
          row("e", "cancelled"),
          { ...row("f"), sessionID: "ses_two" },
          { ...row("g"), kind: "automation" },
          null,
        ],
        "ses_one",
      ).map((item) => item.id),
    ).toEqual(["a", "b", "c"])
  })
  test("the active turn's own running row is not a pending follow-up", () => {
    const active = { ...row("active"), kind: "prompt" as const, status: "running", position: 0 }
    const pending = { ...row("pending", "waiting_for_idle"), position: 1 }
    expect(durableFollowUps([active, pending], "ses_one").map((item) => item.id)).toEqual(["pending"])
    // A running row is the turn in flight whatever its kind; only the queue
    // manager asks for it, and history alone does not resurrect it.
    const running = { ...row("running", "running"), position: 0 }
    expect(durableFollowUps([running, pending], "ses_one", { includeHistory: true }).map((item) => item.id)).toEqual([
      "pending",
    ])
    expect(durableFollowUps([running, pending], "ses_one", { includeActive: true }).map((item) => item.id)).toEqual([
      "running",
      "pending",
    ])
  })
  test("keeps prompt attachments and model selection", () => {
    const item = durableFollowUps([row("a")], "ses_one")[0]
    expect(followUpBody(item)).toEqual(item.payload.body)
    expect(
      followUpStatus({
        ...item,
        status: "failed",
        payload: { ...item.payload, interruptionReason: "backend_restart" },
      }),
    ).toBe("Interrupted - inspect before retry")
  })
  test("snapshot removes stale cache without overwriting events received during refresh", () => {
    const original = row("a")
    const stale = row("stale")
    const before = new Map([original, stale].map((item) => [item.id, JSON.stringify(item)]))
    const completed = { ...original, status: "completed", time: { created: 1, updated: 2 } }
    const newEvent = row("new")
    const other = { ...row("other"), sessionID: "ses_two" }
    const merged = mergeFollowUpSnapshot([completed, stale, newEvent, other], [original], "ses_one", before)
    expect(merged.find((item) => item.id === "a")?.status).toBe("completed")
    expect(merged.map((item) => item.id).sort()).toEqual(["a", "new", "other"])
  })
  test("an in-flight snapshot cannot resurrect a deleted task", () => {
    expect(mergeFollowUpSnapshot([], [row("deleted")], "ses_one", new Map(), new Set(["deleted"]))).toEqual([])
  })
  test("command rows parse, list, and show the derived /goal label", () => {
    const items = durableFollowUps([row("a"), commandRow("cmd_1")], "ses_one")
    expect(items.map((item) => item.id)).toEqual(["a", "cmd_1"])
    const command = items.find((item) => item.id === "cmd_1")!
    expect(followUpLabel(command)).toBe("[command] /goal ship the release")
    expect(followUpStatus(command)).toBe("Queued")
    expect(isTextFollowUp(command)).toBe(false)
    expect(isTextFollowUp(items.find((item) => item.id === "a")!)).toBe(true)
    // Follow-up rows keep their server title byte-for-byte.
    expect(followUpLabel(items.find((item) => item.id === "a")!)).toBe("a")
  })
  test("multi-line command arguments collapse to a single label line", () => {
    const multiLine = commandRow("cmd_1", {
      payload: { body: { command: "goal", arguments: "ship it\nand then the notes" } },
    })
    expect(followUpLabel(durableFollowUps([multiLine], "ses_one")[0])).toBe("[command] /goal ship it")
  })
  test("command rows merge by id across snapshot and event ordering", () => {
    const queued = commandRow("cmd_1")
    const before = new Map([[queued.id, JSON.stringify(queued)]])
    // No fresher event during refresh: the snapshot response wins.
    const completed = { ...queued, status: "completed", time: { created: 2, updated: 3 } }
    expect(mergeFollowUpSnapshot([queued], [completed], "ses_one", before).find((r) => r.id === "cmd_1")?.status).toBe(
      "completed",
    )
    // An event received after the snapshot request takes precedence.
    const running = { ...queued, status: "running", time: { created: 2, updated: 4 } }
    expect(mergeFollowUpSnapshot([running], [queued], "ses_one", before).find((r) => r.id === "cmd_1")?.status).toBe(
      "running",
    )
    // Unknown kinds stay opaque passthrough entries.
    const automation = { ...queued, id: "auto_1", kind: "automation" }
    expect(mergeFollowUpSnapshot([automation], [], "ses_one", new Map())).toEqual([automation])
  })
})

describe("follow-up edit hold", () => {
  function sdk(responses: unknown[]) {
    const requests: string[] = []
    const fake = {
      sseConnected: true,
      url: "http://localhost:4096",
      directory: "/test/workspace",
      fetch: async (input: RequestInfo | URL) => {
        requests.push(String(input))
        return Response.json(responses.shift() ?? row("a"))
      },
    } as unknown as FollowUpSdk
    return { fake, requests }
  }

  /** The row as the projection hands it to the edit flow. */
  function projected(status: string) {
    return durableFollowUps([row("a", status)], "ses_one")[0]!
  }

  test("holds a pending row for editing and restores it when the edit is abandoned", async () => {
    const pending = projected("queued")
    const paused = row("a", "paused")
    // GET returns the row to pause, POST /pause returns the paused row, POST /resume restores it.
    const { fake, requests } = sdk([pending, paused, pending])
    const hold = await pauseFollowUpForEdit(fake, pending)
    expect(hold.changed).toBe(true)
    expect(hold.paused.status).toBe("paused")
    const restored = await cancelFollowUpEdit(fake, hold)
    expect(restored?.status).toBe("queued")
    expect(requests).toEqual([
      "http://localhost:4096/task-queue/a",
      "http://localhost:4096/task-queue/a/pause",
      "http://localhost:4096/task-queue/a/resume",
    ])
  })

  test("an already paused row is not resumed by an abandoned edit", async () => {
    const paused = projected("paused")
    const { fake, requests } = sdk([paused])
    const hold = await pauseFollowUpForEdit(fake, paused)
    expect(hold.changed).toBe(false)
    expect(await cancelFollowUpEdit(fake, hold)).toBeUndefined()
    expect(requests).toEqual(["http://localhost:4096/task-queue/a"])
  })

  test("a stale queued projection does not resume another caller's pause", async () => {
    const { fake, requests } = sdk([row("a", "paused")])
    const hold = await pauseFollowUpForEdit(fake, projected("queued"))
    expect(hold.changed).toBe(false)
    expect(await cancelFollowUpEdit(fake, hold)).toBeUndefined()
    expect(requests).toEqual(["http://localhost:4096/task-queue/a"])
  })

  test("a stale paused projection restores the pause this edit actually acquired", async () => {
    const queued = row("a", "queued")
    const { fake, requests } = sdk([queued, row("a", "paused"), queued])
    const hold = await pauseFollowUpForEdit(fake, projected("paused"))
    expect(hold.changed).toBe(true)
    expect((await cancelFollowUpEdit(fake, hold))?.status).toBe("queued")
    expect(requests).toEqual([
      "http://localhost:4096/task-queue/a",
      "http://localhost:4096/task-queue/a/pause",
      "http://localhost:4096/task-queue/a/resume",
    ])
  })
})
