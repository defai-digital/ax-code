import { afterEach, describe, expect, test } from "bun:test"
import { ServiceManager } from "../../src/runtime/service-manager"

describe("ServiceManager", () => {
  afterEach(() => {
    ServiceManager.clear("/tmp/service-manager")
  })

  test("creates default service status rows", () => {
    const status = ServiceManager.createServiceStatus({ name: "bootstrap" })

    expect(status).toEqual({
      name: "bootstrap",
      state: "idle",
      pendingTasks: 0,
    })
  })

  test("tracks completed runtime tasks in directory state", async () => {
    const manager = ServiceManager.reset("/tmp/service-manager")

    await manager.track({
      service: "Plugin.init",
      label: "plugin init",
      task: async () => undefined,
    })

    const snapshot = manager.snapshot()
    expect(snapshot.services).toEqual([
      expect.objectContaining({
        name: "Plugin.init",
        state: "running",
        pendingTasks: 0,
      }),
    ])
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        service: "Plugin.init",
        label: "plugin init",
        state: "completed",
      }),
    ])
  })

  test("captures task failures on the owning service", async () => {
    const manager = ServiceManager.create()

    await expect(
      manager.track({
        service: "FileWatcher.init",
        label: "file watcher init",
        task: async () => {
          throw new Error("watch failed")
        },
      }),
    ).rejects.toThrow("watch failed")

    const snapshot = manager.snapshot()
    expect(snapshot.services).toEqual([
      expect.objectContaining({
        name: "FileWatcher.init",
        state: "failed",
        lastError: "Error: watch failed",
      }),
    ])
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        service: "FileWatcher.init",
        state: "failed",
        lastError: "Error: watch failed",
      }),
    ])
  })

  test("emits timeout evidence before a slow task finishes", async () => {
    const manager = ServiceManager.create()
    const timeouts = [] as ServiceManager.Snapshot[]
    let release = () => {}

    const task = manager.track({
      service: "Snapshot.init",
      label: "snapshot init",
      timeoutMs: 20,
      task: async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      },
      onTimeout(snapshot) {
        timeouts.push(snapshot)
      },
    })

    await Bun.sleep(40)

    expect(timeouts).toHaveLength(1)
    expect(timeouts[0]?.tasks[0]).toMatchObject({
      service: "Snapshot.init",
      state: "running",
      lastError: "Timed out after 20ms",
    })

    release()
    await task
  })
})
