import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import type { PluginLifecycle } from "@ax-code/plugin"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { PluginLifetime } from "../../src/plugin/lifetime"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Config } from "../../src/config/config"

type Probe = {
  calls: number
  cleaned: number
  release?: () => void
  started?: boolean
  signal?: AbortSignal
  lifetime?: PluginLifecycle
  retained?: { args: { items: string[] } }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function withPlugin(source: string, check: (probe: Probe) => Promise<void>, initialize = true) {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  const probe: Probe = { calls: 0, cleaned: 0 }
  const key = `ax-code-plugin-lifecycle-${crypto.randomUUID()}`
  Reflect.set(globalThis, Symbol.for(key), probe)
  await using tmp = await tmpdir({
    init: async (directory) => {
      const plugins = path.join(directory, ".ax-code", "plugin")
      await fs.mkdir(plugins, { recursive: true })
      await fs.writeFile(
        path.join(plugins, "probe.ts"),
        `const probe = globalThis[Symbol.for(${JSON.stringify(key)})]\n${source}\n`,
      )
    },
  })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          if (initialize) await Plugin.init()
          await check(probe)
        } finally {
          vi.useRealTimers()
          probe.release?.()
          await Instance.dispose()
        }
      },
    })
  } finally {
    Reflect.deleteProperty(globalThis, Symbol.for(key))
  }
}

test("legacy hooks publish ordered mutations while retained data is detached", async () => {
  await withPlugin(
    `
    export const first = async () => ({ "tool.execute.before": async (_input, output) => {
      output.args.items.push("first")
      probe.retained = output
    } })
    export const second = async () => ({ "tool.execute.before": async (_input, output) => {
      output.args.items.push("second")
    } })
  `,
    async (probe) => {
      const items = ["initial"]
      const output = { args: { items } }
      await Plugin.trigger("tool.execute.before", { tool: "read", sessionID: "test", callID: "test" }, output)
      expect(output.args.items).toBe(items)
      expect(items).toEqual(["initial", "first", "second"])
      probe.retained!.args.items.push("late")
      expect(items).toEqual(["initial", "first", "second"])
    },
  )
})

test("a timed-out hook cannot publish partial or late changes and is retired", async () => {
  await withPlugin(
    `
    export default async ({ lifecycle }) => {
      probe.lifetime = lifecycle
      lifecycle.onDispose(() => { probe.cleaned++ })
      return { "tool.execute.before": async (_input, output, context) => {
        probe.calls++
        probe.signal = context.signal
        probe.started = true
        output.args.items.push("partial")
        await new Promise(resolve => { probe.release = resolve })
        output.args.items.push("late")
      } }
    }
  `,
    async (probe) => {
      vi.useFakeTimers()
      const output = { args: { items: ["initial"] } }
      const input = { tool: "read", sessionID: "test", callID: "test" }
      const pending = Plugin.trigger("tool.execute.before", input, output)
      await vi.advanceTimersByTimeAsync(PluginLifetime.CALLBACK_TIMEOUT_MS)
      await pending
      expect(probe.started).toBe(true)
      expect(probe.signal!.aborted).toBe(true)
      expect(probe.lifetime!.signal.aborted).toBe(true)
      expect(output.args.items).toEqual(["initial"])
      probe.release!()
      await vi.advanceTimersByTimeAsync(0)
      await Plugin.trigger("tool.execute.before", input, output)
      expect(output.args.items).toEqual(["initial"])
      expect(probe.calls).toBe(1)
      expect(probe.cleaned).toBe(1)
    },
  )
})

test("instance disposal cancels a pending hook instead of continuing its caller", async () => {
  await withPlugin(
    `
    export default async ({ lifecycle }) => {
      probe.lifetime = lifecycle
      lifecycle.onDispose(() => { probe.cleaned++ })
      return { "tool.execute.before": async (_input, output) => {
        probe.started = true
        await new Promise(resolve => { probe.release = resolve })
        output.args.items.push("late")
      } }
    }
  `,
    async (probe) => {
      const output = { args: { items: [] as string[] } }
      const pending = Plugin.trigger(
        "tool.execute.before",
        { tool: "read", sessionID: "test", callID: "test" },
        output,
      ).catch((error) => error)
      await vi.waitFor(() => expect(probe.started).toBe(true))
      await Instance.dispose()
      expect((await pending).data.reason).toBe("disposed")
      probe.release!()
      await Promise.resolve()
      expect(output.args.items).toEqual([])
      expect(probe.cleaned).toBe(1)
    },
  )
})

test("disposal can interrupt plugin initialization and reload creates a fresh lifetime", async () => {
  await withPlugin(
    `
    export default async ({ lifecycle }) => {
      probe.calls++
      probe.lifetime = lifecycle
      lifecycle.onDispose(() => { probe.cleaned++ })
      if (probe.calls === 1) {
        probe.started = true
        await new Promise(resolve => { probe.release = resolve })
      }
      return {}
    }
  `,
    async (probe) => {
      const pending = Plugin.init().catch((error) => error)
      await vi.waitFor(() => expect(probe.started).toBe(true))
      const previous = probe.lifetime!
      await Instance.dispose()
      expect((await pending).data.reason).toBe("disposed")
      expect(previous.signal.aborted).toBe(true)
      probe.release!()
      await Plugin.init()
      expect(probe.lifetime).not.toBe(previous)
      expect(probe.lifetime!.signal.aborted).toBe(false)
      expect(probe.calls).toBe(2)
      expect(probe.cleaned).toBe(1)
      await Instance.dispose()
      expect(probe.cleaned).toBe(2)
    },
    false,
  )
})

test("failed configuration is discarded and its cleanup runs without skipping a healthy plugin", async () => {
  await withPlugin(
    `
    export const first = async ({ lifecycle }) => {
      lifecycle.onDispose(() => { probe.cleaned++ })
      return { config: async config => { config.username = "failed"; throw new Error("failure") } }
    }
    export const second = async () => ({ config: async config => { config.username = "healthy" } })
  `,
    async (probe) => {
      expect((await Config.get()).username).toBe("healthy")
      expect(probe.cleaned).toBe(1)
    },
  )
})

test.each(["deny", "error", "invalid"])("permission %s cannot be overridden by a later allow", async (mode) => {
  await withPlugin(
    `
    export const first = async () => ({ "permission.ask": async (_input, output) => {
      output.status = ${JSON.stringify(mode === "deny" ? "deny" : mode === "invalid" ? "invalid" : "allow")}
      ${mode === "error" ? 'throw new Error("failure")' : ""}
    } })
    export const second = async () => ({ "permission.ask": async (_input, output) => { output.status = "allow" } })
  `,
    async () => {
      const output = { status: "ask" }
      await Plugin.trigger("permission.ask", {}, output)
      expect(output.status).toBe(mode === "deny" ? "deny" : "ask")
    },
  )
})

test("event observers cannot mutate the published payload", async () => {
  const event = BusEvent.define("test.plugin.lifetime", z.object({ value: z.string() }))
  await withPlugin(
    `
    export default async () => ({ event: async ({ event }) => {
      if (event.type !== "test.plugin.lifetime") return
      probe.calls++
      event.properties.value = "changed"
    } })
  `,
    async (probe) => {
      const payload = { value: "original" }
      await Bus.publish(event, payload)
      expect(probe.calls).toBe(1)
      expect(payload.value).toBe("original")
    },
  )
})

test("a failed transformation discards its draft and lets a healthy hook continue", async () => {
  await withPlugin(
    `
    export const first = async () => ({ "tool.execute.before": async (input, output) => {
      input.tool = "changed"
      output.args.items.push("partial")
      throw new Error("private callback details")
    } })
    export const second = async () => ({ "tool.execute.before": async (input, output) => {
      output.args.items.push(input.tool)
    } })
  `,
    async () => {
      const input = { tool: "read", sessionID: "test", callID: "test" }
      const output = { args: { items: [] as string[] } }
      await Plugin.trigger("tool.execute.before", input, output)
      expect(input.tool).toBe("read")
      expect(output.args.items).toEqual(["read"])
    },
  )
})

test("stalled initialization times out without registering late hooks or blocking healthy plugins", async () => {
  await withPlugin(
    `
    export const first = async ({ lifecycle }) => {
      lifecycle.onDispose(() => { probe.cleaned++ })
      probe.lifetime = lifecycle
      probe.started = true
      await new Promise(resolve => { probe.release = resolve })
      return { "tool.execute.before": async () => { probe.calls += 100 } }
    }
    export const second = async () => ({ "tool.execute.before": async () => { probe.calls++ } })
  `,
    async (probe) => {
      // Complete configuration I/O before controlling the callback clock.
      await Config.get()
      vi.useFakeTimers()
      const pending = Plugin.init()
      await vi.waitFor(() => expect(probe.started).toBe(true))
      await vi.advanceTimersByTimeAsync(PluginLifetime.CALLBACK_TIMEOUT_MS)
      await pending
      expect(probe.lifetime!.signal.aborted).toBe(true)
      expect(probe.cleaned).toBe(1)
      probe.release!()
      await vi.advanceTimersByTimeAsync(0)
      await Plugin.trigger("tool.execute.before", {}, { args: {} })
      expect(probe.calls).toBe(1)
    },
    false,
  )
})

test("a retired permission hook keeps later requests at ask", async () => {
  await withPlugin(
    `
    export const first = async () => ({ "permission.ask": async () => {
      probe.calls++
      await new Promise(resolve => { probe.release = resolve })
    } })
    export const second = async () => ({ "permission.ask": async (_input, output) => { output.status = "allow" } })
  `,
    async (probe) => {
      vi.useFakeTimers()
      const first = { status: "ask" }
      const pending = Plugin.trigger("permission.ask", {}, first)
      await vi.advanceTimersByTimeAsync(PluginLifetime.CALLBACK_TIMEOUT_MS)
      await pending
      expect(first.status).toBe("ask")
      const next = { status: "ask" }
      await Plugin.trigger("permission.ask", {}, next)
      expect(next.status).toBe("ask")
      expect(probe.calls).toBe(1)
    },
  )
})

test("a stalled event observer cannot prevent healthy observers from receiving events", async () => {
  const event = BusEvent.define("test.plugin.observer-deadline", z.object({ value: z.string() }))
  await withPlugin(
    `
    export const first = async () => ({ event: async ({ event }, context) => {
      if (event.type !== "test.plugin.observer-deadline") return
      probe.signal = context.signal
      await new Promise(resolve => { probe.release = resolve })
    } })
    export const second = async () => ({ event: async ({ event }) => {
      if (event.type === "test.plugin.observer-deadline") probe.calls++
    } })
  `,
    async (probe) => {
      vi.useFakeTimers()
      const pending = Bus.publish(event, { value: "first" })
      await vi.advanceTimersByTimeAsync(0)
      expect(probe.calls).toBe(1)
      await vi.advanceTimersByTimeAsync(PluginLifetime.CALLBACK_TIMEOUT_MS)
      await pending
      expect(probe.signal!.aborted).toBe(true)
      await Bus.publish(event, { value: "second" })
      expect(probe.calls).toBe(2)
    },
  )
})

test("disposal stops callers waiting for config dependencies before a plugin factory starts", async () => {
  await withPlugin(
    `export default async () => { probe.calls++; return {} }`,
    async (probe) => {
      await Config.get()
      let release!: () => void
      const dependencies = vi.spyOn(Config, "waitForDependencies").mockImplementation(() => {
        probe.started = true
        return new Promise<void>((resolve) => {
          release = resolve
        })
      })
      const pending = Plugin.init().catch((error) => error)
      await vi.waitFor(() => expect(probe.started).toBe(true))
      await Instance.dispose()
      expect(await pending).toMatchObject({ data: { reason: "disposed" } })
      expect(probe.calls).toBe(0)
      dependencies.mockRestore()
      release()
      await Plugin.init()
      expect(probe.calls).toBe(1)
    },
    false,
  )
})
