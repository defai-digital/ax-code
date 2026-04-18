import { describe, expect, test } from "bun:test"
import { RuntimeDebugSnapshot } from "../../src/runtime/debug-snapshot"
import { ServiceManager } from "../../src/runtime/service-manager"

describe("RuntimeDebugSnapshot", () => {
  test("creates metadata-only runtime snapshots", () => {
    const snapshot = RuntimeDebugSnapshot.create({
      trigger: "startup",
      time: 123,
      services: [ServiceManager.createServiceStatus({ name: "bootstrap", state: "starting", pendingTasks: 2 })],
      queues: [
        {
          name: "sdk-events",
          currentDepth: 2,
          maxDepth: 64,
          highWaterMark: 8,
          droppedEvents: 0,
          coalescedEvents: 1,
          lastFlushDurationMs: 4,
          overflowPolicy: "coalesce",
          coalescingPolicy: "message_part_delta",
        },
      ],
    })

    expect(snapshot).toMatchObject({
      trigger: "startup",
      services: [{ name: "bootstrap", state: "starting", pendingTasks: 2 }],
      queues: [{ name: "sdk-events", overflowPolicy: "coalesce" }],
    })
  })

  test("captures instance metadata and a classified failure", () => {
    const snapshot = RuntimeDebugSnapshot.create({
      trigger: "service_failure",
      time: 456,
      failureClass: "service_bootstrap",
      instance: {
        directory: "/tmp/project",
        worktree: "/tmp/project",
        projectID: "project-1",
      },
    })

    expect(snapshot.failureClass).toBe("service_bootstrap")
    expect(snapshot.instance?.projectID).toBe("project-1")
  })
})
