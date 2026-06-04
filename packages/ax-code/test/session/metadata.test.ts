import { describe, expect, test } from "bun:test"
import path from "path"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionMetadata } from "../../src/session/metadata"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session metadata product schemas", () => {
  test("validates reserved product metadata namespaces", () => {
    expect(
      SessionMetadata.product({
        queue: { queueItemId: "task_1", groupId: "group_1", source: "workflow" },
        multiRun: { groupId: "group_1", variantId: "variant_1", model: "gpt", agent: "build" },
        automation: { taskId: "scheduled_1", runId: "run_1", owner: "attached-backend" },
        review: { reviewId: "review_1", baseline: "main" },
        app: { pinned: true, label: "Release check" },
        custom: { untouched: true },
      }),
    ).toEqual({
      queue: { queueItemId: "task_1", groupId: "group_1", source: "workflow" },
      multiRun: { groupId: "group_1", variantId: "variant_1", model: "gpt", agent: "build" },
      automation: { taskId: "scheduled_1", runId: "run_1", owner: "attached-backend" },
      review: { reviewId: "review_1", baseline: "main" },
      app: { pinned: true, label: "Release check" },
    })
  })

  test("rejects invalid reserved enum values", () => {
    expect(() =>
      SessionMetadata.validate({
        queue: { source: "daemon" },
      }),
    ).toThrow()
  })

  test("rejects unsafe keys inside reserved namespaces", () => {
    expect(() =>
      SessionMetadata.validate({
        app: { label: "Do not leak", token: "secret-value" },
      }),
    ).toThrow("unsafe key")
  })

  test("rejects oversized reserved metadata payloads", () => {
    expect(() =>
      SessionMetadata.validate({
        app: { label: "x".repeat(SessionMetadata.MAX_PRODUCT_METADATA_BYTES + 1) },
      }),
    ).toThrow("Reserved session metadata is too large")
  })

  test("setProductMetadata merges only the owned namespace and publishes session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const updated: Session.Info[] = []
        const unsubscribe = Bus.subscribe(Session.Event.Updated, (event) => {
          updated.push(event.properties.info)
        })

        try {
          await Session.setMetadata({
            sessionID: session.id,
            metadata: {
              custom: { keep: true },
              app: { label: "Before" },
            },
          })

          const next = await Session.setProductMetadata({
            sessionID: session.id,
            namespace: "queue",
            value: { queueItemId: "task_1", source: "manual" },
          })

          expect(next.metadata).toEqual({
            custom: { keep: true },
            app: { label: "Before" },
            queue: { queueItemId: "task_1", source: "manual" },
          })

          await new Promise((resolve) => setTimeout(resolve, 20))
          expect(updated.some((info) => info.id === session.id && info.metadata?.queue !== undefined)).toBe(true)
        } finally {
          unsubscribe()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("setMetadata preserves non-reserved keys but rejects invalid reserved namespaces", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        try {
          expect(() =>
            Session.setMetadata({
              sessionID: session.id,
              metadata: {
                custom: { keep: true },
                automation: { taskId: "task_1", owner: "worker" },
              },
            }),
          ).toThrow()

          const next = await Session.setMetadata({
            sessionID: session.id,
            metadata: {
              custom: { keep: true },
            },
          })
          expect(next.metadata).toEqual({ custom: { keep: true } })
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })
})
