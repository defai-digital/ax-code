import { describe, expect, test } from "vitest"
import type { DurableFollowUp, FollowUpSdk } from "../../../src/cli/tui/component/prompt/durable-follow-up"
import {
  steerBarrier,
  steerFollowUp,
  steerQueuedPrefix,
  steerablePrefix,
  STEER_MAX_TEXT_LENGTH,
} from "../../../src/cli/tui/component/prompt/steer-follow-up"

function row(input: {
  id: string
  text?: string
  parts?: unknown[]
  status?: DurableFollowUp["status"]
  position?: number
  sessionID?: string
  body?: unknown
}): DurableFollowUp {
  return {
    id: input.id,
    sessionID: input.sessionID ?? "ses_1",
    kind: "followup",
    status: input.status ?? "waiting_for_idle",
    title: (input.text ?? "follow up").slice(0, 40),
    position: input.position ?? 0,
    time: { created: 1 },
    payload: {
      body: input.body ?? {
        parts: input.parts ?? [{ type: "text", text: input.text ?? "follow up" }],
        agent: "build",
        model: { providerID: "p", modelID: "m" },
        variant: "default",
      },
    },
  }
}

describe("steerBarrier", () => {
  test("text-only pending rows are steerable even with the composer snapshot fields", () => {
    expect(steerBarrier(row({ id: "tas_1" }))).toBeNull()
    expect(steerBarrier(row({ id: "tas_2", status: "queued" }))).toBeNull()
  })

  test("paused rows and non-pending statuses are barriers", () => {
    expect(steerBarrier(row({ id: "tas_1", status: "paused" }))).toBe("paused")
    expect(steerBarrier(row({ id: "tas_2", status: "running" }))).toBe("status")
    expect(steerBarrier(row({ id: "tas_3", status: "failed" }))).toBe("status")
  })

  test("attachments, empty text, and oversize text are barriers", () => {
    expect(
      steerBarrier(
        row({
          id: "tas_1",
          parts: [
            { type: "text", text: "see this" },
            { type: "file", url: "file:///tmp/a.ts" },
          ],
        }),
      ),
    ).toBe("attachments")
    expect(steerBarrier(row({ id: "tas_2", text: "   " }))).toBe("empty")
    expect(steerBarrier(row({ id: "tas_3", text: "x".repeat(STEER_MAX_TEXT_LENGTH + 1) }))).toBe("too_long")
    expect(steerBarrier(row({ id: "tas_4", body: {} }))).toBe("empty")
  })
})

describe("steerablePrefix", () => {
  test("takes the leading steerable rows and stops at the first barrier", () => {
    const rows = [
      row({ id: "tas_1", position: 0 }),
      row({ id: "tas_2", position: 1 }),
      row({ id: "tas_3", position: 2, status: "paused" }),
      row({ id: "tas_4", position: 3 }),
    ]
    const prefix = steerablePrefix(rows)
    expect(prefix.items.map((item) => item.id)).toEqual(["tas_1", "tas_2"])
    expect(prefix.barrier?.item.id).toBe("tas_3")
    expect(prefix.barrier?.reason).toBe("paused")
  })

  test("an all-steerable queue has no barrier; a leading barrier yields an empty prefix", () => {
    const open = steerablePrefix([row({ id: "tas_1" }), row({ id: "tas_2", position: 1 })])
    expect(open.items).toHaveLength(2)
    expect(open.barrier).toBeUndefined()
    const blocked = steerablePrefix([row({ id: "tas_1", text: "" }), row({ id: "tas_2", position: 1 })])
    expect(blocked.items).toHaveLength(0)
    expect(blocked.barrier?.reason).toBe("empty")
  })
})

function sdk(handlers: {
  steer?: (id: string) => { status?: number; body?: unknown }
  sendNow?: (id: string) => { status?: number; body?: unknown }
  connected?: boolean
}) {
  const calls: Array<{ url: string; method?: string }> = []
  const fake: FollowUpSdk = {
    sseConnected: handlers.connected ?? true,
    url: "http://localhost:4096",
    directory: "/test/workspace",
    fetch: async (input, init) => {
      const url = String(input)
      calls.push({ url, method: init?.method })
      if (url.endsWith("/steer")) {
        const id = decodeURIComponent(url.split("/task-queue/")[1]!.split("/steer")[0]!)
        const result = handlers.steer?.(id) ?? {}
        return Response.json(result.body ?? {}, { status: result.status ?? 200 })
      }
      if (url.endsWith("/send-now")) {
        const id = decodeURIComponent(url.split("/task-queue/")[1]!.split("/send-now")[0]!)
        const result = handlers.sendNow?.(id) ?? {}
        return Response.json(result.body ?? {}, { status: result.status ?? 200 })
      }
      return Response.json({ message: "unexpected request" }, { status: 500 })
    },
  }
  return { fake, calls }
}

function cancelledRow(source: DurableFollowUp, generation: string): Record<string, unknown> {
  return {
    ...source,
    status: "cancelled",
    payload: { ...source.payload, steeredInto: generation, steeredAt: 1000 },
  }
}

describe("steerFollowUp", () => {
  test("delivers through the atomic endpoint and returns the cancelled row", async () => {
    const item = row({ id: "tas_1" })
    const { fake, calls } = sdk({
      steer: () => ({ body: { item: cancelledRow(item, "gen-1"), receipt: { status: "accepted" } } }),
    })
    const outcome = await steerFollowUp(fake, item)
    expect(outcome.kind).toBe("delivered")
    if (outcome.kind === "delivered") expect(outcome.item.status).toBe("cancelled")
    expect(calls).toEqual([{ url: "http://localhost:4096/task-queue/tas_1/steer", method: "POST" }])
  })

  test("without an active generation it prioritizes the row and reports queued_next", async () => {
    const item = row({ id: "tas_1" })
    const { fake, calls } = sdk({
      steer: () => ({ body: { item, receipt: null, reason: "generation_not_active" } }),
      sendNow: () => ({ body: { ...item, status: "queued", position: 0 } }),
    })
    const outcome = await steerFollowUp(fake, item)
    expect(outcome.kind).toBe("queued_next")
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4096/task-queue/tas_1/steer",
      "http://localhost:4096/task-queue/tas_1/send-now",
    ])
  })

  test("does not send-now a row the server already restarted after the generation ended", async () => {
    const item = row({ id: "tas_1" })
    const { fake, calls } = sdk({
      steer: () => ({
        body: {
          item: { ...item, status: "running" },
          receipt: { status: "rejected", reason: "generation_not_active" },
        },
      }),
      sendNow: () => ({ status: 409, body: { message: "Cannot send now task queue item tas_1 while it is running." } }),
    })
    const outcome = await steerFollowUp(fake, item)
    expect(outcome.kind).toBe("queued_next")
    if (outcome.kind === "queued_next") expect(outcome.item.status).toBe("running")
    expect(calls.map((call) => call.url)).toEqual(["http://localhost:4096/task-queue/tas_1/steer"])
  })

  test("still prioritizes a rejected row the server left pending", async () => {
    const item = row({ id: "tas_1" })
    const { fake, calls } = sdk({
      steer: () => ({
        body: {
          item: { ...item, status: "waiting_for_idle" },
          receipt: { status: "rejected", reason: "generation_not_active" },
        },
      }),
      sendNow: () => ({ body: { ...item, status: "queued", position: 0 } }),
    })
    const outcome = await steerFollowUp(fake, item)
    expect(outcome.kind).toBe("queued_next")
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4096/task-queue/tas_1/steer",
      "http://localhost:4096/task-queue/tas_1/send-now",
    ])
  })

  test("admission rejections and transport failures leave the row alone", async () => {
    const rejected = sdk({
      steer: () => ({ body: { item: row({ id: "tas_1" }), receipt: { status: "rejected", reason: "admission_rejected" } } }),
    })
    expect(await steerFollowUp(rejected.fake, row({ id: "tas_1" }))).toEqual({
      kind: "failed",
      message: "admission_rejected",
    })
    expect(rejected.calls).toHaveLength(1)

    const transport = sdk({ steer: () => ({ status: 409, body: { message: "row changed" } }) })
    expect(await steerFollowUp(transport.fake, row({ id: "tas_1" }))).toEqual({
      kind: "failed",
      message: "row changed",
    })
  })

  test("a disconnected client never issues requests", async () => {
    const { fake, calls } = sdk({ connected: false })
    const outcome = await steerFollowUp(fake, row({ id: "tas_1" }))
    expect(outcome.kind).toBe("failed")
    expect(calls).toHaveLength(0)
  })
})

describe("steerQueuedPrefix", () => {
  test("steers the prefix in order and reports the remaining count", async () => {
    const rows = [row({ id: "tas_1", position: 0 }), row({ id: "tas_2", position: 1 })]
    const { fake, calls } = sdk({
      steer: (id) => ({
        body: {
          item: cancelledRow(rows.find((item) => item.id === id)!, "gen-1"),
          receipt: { status: "accepted" },
        },
      }),
    })
    const outcome = await steerQueuedPrefix(fake, rows)
    expect(outcome.steered.map((item) => item.id)).toEqual(["tas_1", "tas_2"])
    expect(outcome.remaining).toBe(0)
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4096/task-queue/tas_1/steer",
      "http://localhost:4096/task-queue/tas_2/steer",
    ])
  })

  test("stops after the first failure so later rows keep their order", async () => {
    const rows = [row({ id: "tas_1", position: 0 }), row({ id: "tas_2", position: 1 })]
    const { fake, calls } = sdk({
      steer: (id) =>
        id === "tas_1"
          ? { status: 409, body: { message: "row changed" } }
          : { body: { item: cancelledRow(rows[1]!, "gen-1"), receipt: { status: "accepted" } } },
    })
    const outcome = await steerQueuedPrefix(fake, rows)
    expect(outcome.failed).toBe("row changed")
    expect(outcome.steered).toHaveLength(0)
    expect(outcome.remaining).toBe(2)
    expect(calls).toHaveLength(1)
  })

  test("prioritizes only the first miss when the generation is gone", async () => {
    const rows = [row({ id: "tas_1", position: 0 }), row({ id: "tas_2", position: 1 })]
    const { fake, calls } = sdk({
      steer: (id) => ({ body: { item: rows.find((item) => item.id === id), receipt: null, reason: "generation_not_active" } }),
      sendNow: (id) => ({ body: { ...rows.find((item) => item.id === id), status: "queued", position: 0 } }),
    })
    const outcome = await steerQueuedPrefix(fake, rows)
    expect(outcome.queuedNext.map((item) => item.id)).toEqual(["tas_1"])
    expect(outcome.remaining).toBe(1)
    expect(calls).toHaveLength(2)
  })

  test("a leading barrier steers nothing and issues no requests", async () => {
    const rows = [row({ id: "tas_1", position: 0, status: "paused" }), row({ id: "tas_2", position: 1 })]
    const { fake, calls } = sdk({})
    const outcome = await steerQueuedPrefix(fake, rows)
    expect(outcome.steered).toHaveLength(0)
    expect(outcome.barrier?.reason).toBe("paused")
    expect(outcome.remaining).toBe(2)
    expect(calls).toHaveLength(0)
  })
})
