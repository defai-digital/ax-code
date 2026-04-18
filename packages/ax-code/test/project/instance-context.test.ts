import { describe, expect, test } from "bun:test"
import { Context } from "../../src/util/context"
import { Instance } from "../../src/project/instance"
import { ServiceManager } from "../../src/runtime/service-manager"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Context.peek", () => {
  test("returns the current value without throwing", async () => {
    const ctx = Context.create<{ value: string }>("phase0")

    expect(ctx.peek()).toBeUndefined()
    expect(await ctx.provide({ value: "ready" }, async () => ctx.peek()?.value)).toBe("ready")
  })
})

describe("Instance context extensions", () => {
  test("preserves instance context across bound async callbacks", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(
            Instance.bind(() => {
              expect(Instance.directory).toBe(tmp.path)
              resolve()
            }),
            0,
          )
        })
      },
    })
  })

  test("emits lifecycle events and lists cached instances for instrumentation", async () => {
    await using tmp = await tmpdir()
    const events = [] as Instance.LifecycleEvent[]
    const unsubscribe = Instance.onLifecycle((event) => {
      if (event.directory && event.directory !== tmp.path) return
      events.push(event)
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(Instance.list()).toContain(tmp.path)
          await Instance.dispose()
        },
      })
    } finally {
      unsubscribe()
    }

    expect(events.map((item) => item.kind)).toEqual(["boot.start", "boot.ready", "dispose.start", "dispose.ready"])
    expect(Instance.list()).not.toContain(tmp.path)
  })

  test("builds runtime snapshots from tracked services in the current instance", async () => {
    await using tmp = await tmpdir()

    const snapshot = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Instance.runtime().track({
          service: "Format.init",
          label: "format init",
          task: async () => undefined,
        })

        return Instance.runtimeSnapshot({
          trigger: "startup",
        })
      },
    })

    expect(snapshot.instance?.directory).toBe(tmp.path)
    expect(snapshot.services).toContainEqual(
      expect.objectContaining({
        name: "Format.init",
        state: "running",
        pendingTasks: 0,
      }),
    )
    expect(snapshot.tasks).toContainEqual(
      expect.objectContaining({
        service: "Format.init",
        state: "completed",
      }),
    )
  })

  test("does not create empty runtime state when snapshotting an unknown workspace", async () => {
    await using tmp = await tmpdir()

    expect(ServiceManager.peek(tmp.path)).toBeUndefined()

    const snapshot = Instance.runtimeSnapshot({
      trigger: "workspace_switch",
      directory: tmp.path,
    })

    expect(snapshot.instance?.directory).toBe(tmp.path)
    expect(snapshot.services).toEqual([])
    expect(snapshot.tasks).toEqual([])
    expect(ServiceManager.peek(tmp.path)).toBeUndefined()
  })
})
