import { afterEach, describe, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import fs from "fs/promises"
import path from "path"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { MCP } from "../../src/mcp"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

// ADR-138: mode-driven idle "Allow once" — full-access + autonomous +
// an eligible pending permission at the head of its queue gets a server-side
// deadline that auto-replies "once"; any human reply cancels it. The tests
// use the AX_CODE_PERMISSION_IDLE_ONCE_MS debug override with real timers.
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

function armedEnv() {
  vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
  vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
  vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "50")
}

const ARMED_CONFIG = {
  experimental: {
    permission_idle_once: { enabled: true as const, timeout_ms: 5_000 },
  },
} as const

async function waitForPending() {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const list = await Permission.list()
    if (list.length > 0) {
      // Flush real time so askPromise reaches its `await deferred.promise`
      // before a test rejects the ask — otherwise the raw deferred.promise
      // rejection is briefly handlerless and Node reports it as unhandled
      // (config reads and flag resolution cost several macrotask hops).
      await sleep(25)
      return list
    }
    await sleep(5)
  }
  throw new Error("ask never became pending")
}

// The autoOnceAt stamp lands synchronously with the pending entry (the gate
// reads the instance-init config snapshot), so this usually returns on the
// first poll; polling keeps the helper robust against scheduling jitter.
async function waitForAutoOnceAt(requestID: string): Promise<number> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const list = await Permission.list()
    const entry = list.find((item) => item.id === requestID)
    if (entry?.autoOnceAt) return entry.autoOnceAt
    await sleep(5)
  }
  throw new Error("autoOnceAt was never stamped")
}

function askDestructive(sessionID: SessionID, pattern: string) {
  return Permission.ask({
    sessionID,
    permission: "bash_destructive",
    patterns: [pattern],
    metadata: {},
    always: [],
    ruleset: [],
  })
}

describe("permission idle-once deadline (ADR-138)", () => {
  test("auto-replies once when the deadline fires unattended", async () => {
    armedEnv()
    await using tmp = await tmpdir({ git: true, config: ARMED_CONFIG as never })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once")
        const replies: string[] = []
        const unsubscribe = Bus.subscribe(Permission.Event.Replied, (event) => replies.push(event.properties.reply))
        try {
          const ask = askDestructive(sessionID, "rm -rf /tmp/x")
          const pending = await waitForPending()
          // The countdown travels with the request so clients can render it.
          const autoOnceAt = await waitForAutoOnceAt(pending[0]!.id)
          expect(autoOnceAt).toBeGreaterThan(Date.now())

          await expect(ask).resolves.toBeUndefined()
          expect(replies).toEqual(["once"])
          expect(await Permission.list()).toEqual([])
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test("a human reply cancels the deadline", async () => {
    armedEnv()
    await using tmp = await tmpdir({ git: true, config: ARMED_CONFIG as never })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_human")
        const replies: string[] = []
        const unsubscribe = Bus.subscribe(Permission.Event.Replied, (event) => replies.push(event.properties.reply))
        try {
          const ask = askDestructive(sessionID, "rm -rf /tmp/y")
          const pending = await waitForPending()
          // Wait for the deadline to arm first so this test exercises the
          // cancel path (a reply before arming means no timer ever exists).
          await waitForAutoOnceAt(pending[0]!.id)
          const rejection = expect(ask).rejects.toThrow("rejected")
          await Permission.reply({ requestID: pending[0]!.id, reply: "reject" })
          await rejection

          await sleep(150)
          expect(replies).toEqual(["reject"])
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test("queued asks receive a fresh countdown when the head completes", async () => {
    armedEnv()
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "300")
    await using tmp = await tmpdir({ git: true, config: ARMED_CONFIG as never })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_queue")
        const first = askDestructive(sessionID, "rm -rf /tmp/a")
        const head = (await waitForPending())[0]!
        const second = askDestructive(sessionID, "rm -rf /tmp/b")

        // Wait until both are pending.
        const deadline = Date.now() + 5_000
        let list = await Permission.list()
        while (Date.now() < deadline && list.length < 2) {
          await sleep(5)
          list = await Permission.list()
        }
        expect(list).toHaveLength(2)
        const tail = list.find((item) => item.id !== head.id)!
        expect(await waitForAutoOnceAt(head.id)).toBeGreaterThan(Date.now())
        expect(tail.autoOnceAt).toBeUndefined()

        // The head auto-replies at its deadline.
        await first
        expect(await waitForAutoOnceAt(tail.id)).toBeGreaterThan(head.autoOnceAt!)
        await second
        expect(await Permission.list()).toEqual([])
      },
    })
  })

  test.each([
    ["supervised (autonomous off)", { autonomous: "0", isolation: "full-access" }],
    ["sandboxed (workspace-write)", { autonomous: "1", isolation: "workspace-write" }],
  ])("does not arm when %s", async (_label, env) => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", env.autonomous)
    vi.stubEnv("AX_CODE_ISOLATION_MODE", env.isolation)
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "50")
    await using tmp = await tmpdir({ git: true, config: ARMED_CONFIG as never })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_gated")
        const ask = askDestructive(sessionID, "rm -rf /tmp/z")
        const pending = await waitForPending()
        expect(pending[0]!.autoOnceAt).toBeUndefined()
        const rejection = expect(ask).rejects.toThrow("rejected")
        await Permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        await rejection
      },
    })
  })

  test("a mid-session sandbox toggle suppresses the deadline", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "50")
    // No AX_CODE_ISOLATION_MODE: the gate falls back to the config/default
    // mode, which the PUT /isolation flow can change mid-session.
    await using tmp = await tmpdir({ git: true, config: ARMED_CONFIG as never })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_toggle")
        const first = askDestructive(sessionID, "rm -rf /tmp/t1")
        const firstPending = await waitForPending()
        await waitForAutoOnceAt(firstPending[0]!.id)
        await first

        // Mimic the PUT /isolation flow: persist a restricted mode straight
        // to the project config, then drop the config cache and re-read
        // (persistProjectConfig + Config.getFresh). The idle-once gate must
        // observe the new mode on the very next ask — a stale snapshot would
        // auto-approve a destructive command in a session the user just
        // sandboxed.
        await fs.writeFile(
          path.join(tmp.path, "ax-code.json"),
          JSON.stringify({ ...ARMED_CONFIG, isolation: { mode: "workspace-write", network: false } }),
        )
        await Config.invalidate()
        expect((await Config.get()).isolation?.mode).toBe("workspace-write")

        const second = askDestructive(sessionID, "rm -rf /tmp/t2")
        const secondPending = await waitForPending()
        expect(secondPending[0]!.autoOnceAt).toBeUndefined()
        const rejection = expect(second).rejects.toThrow("rejected")
        await Permission.reply({ requestID: secondPending[0]!.id, reply: "reject" })
        await rejection
      },
    })
  })

  test("is armed by default (no config) for any non-excluded interactive permission", async () => {
    armedEnv()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = Permission.ask({
          sessionID: SessionID.make("ses_idle_once_default"),
          permission: "task_spawn",
          patterns: ["x"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        const pending = await waitForPending()
        await waitForAutoOnceAt(pending[0]!.id)
        await ask
      },
    })
  })

  test.each([undefined, 20_000])(
    "webmcp countdown is always 15 seconds, including legacy timeout config (%s)",
    async (timeoutMs) => {
      vi.spyOn(MCP, "isWebMcpConnected").mockImplementation((name) => name === "bridge")
      vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
      vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
      vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "")
      await using tmp = await tmpdir({
        git: true,
        config:
          timeoutMs === undefined ? undefined : { experimental: { permission_idle_once: { timeout_ms: timeoutMs } } },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const before = Date.now()
          const ask = Permission.ask({
            sessionID: SessionID.make("ses_idle_once_webmcp"),
            permission: "webmcp",
            patterns: ["navigate_page"],
            metadata: { server: "bridge" },
            always: [],
            ruleset: [],
          })
          const pending = await waitForPending()
          const deadline = await waitForAutoOnceAt(pending[0]!.id)
          const expectedTimeout = 15_000
          expect(deadline).toBeGreaterThanOrEqual(before + expectedTimeout)
          expect(deadline).toBeLessThanOrEqual(Date.now() + expectedTimeout)
          await Permission.reply({ requestID: pending[0]!.id, reply: "once" })
          await ask
        },
      })
    },
  )

  test("enabled: false is the kill switch", async () => {
    armedEnv()
    await using tmp = await tmpdir({
      git: true,
      config: { experimental: { permission_idle_once: { enabled: false } } } as never,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = askDestructive(SessionID.make("ses_idle_once_off"), "rm -rf /tmp/off")
        const pending = await waitForPending()
        expect(pending[0]!.autoOnceAt).toBeUndefined()
        const rejection = expect(ask).rejects.toThrow("rejected")
        await Permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        await rejection
      },
    })
  })

  test("requireInteractive still allows a countdown under minimal-interaction mode", async () => {
    armedEnv()
    await using tmp = await tmpdir({ git: true, config: ARMED_CONFIG as never })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_interactive")
        const ask = Permission.ask({
          sessionID,
          permission: "bash_destructive",
          patterns: ["rm -rf /tmp/i"],
          metadata: { requireInteractive: true },
          always: [],
          ruleset: [],
        })
        const pending = await waitForPending()
        expect(pending[0]!.autoOnceAt).toBeTypeOf("number")
        await ask
      },
    })
  })

  test("the env override is capped at the setTimeout maximum", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
    // Above Node's 2^31-1ms setTimeout ceiling: without the cap the delay
    // would clamp to ~1ms and auto-approve almost immediately.
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "9999999999")
    await using tmp = await tmpdir({ git: true, config: ARMED_CONFIG as never })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_cap")
        const ask = askDestructive(sessionID, "rm -rf /tmp/cap")
        const pending = await waitForPending()
        const at = await waitForAutoOnceAt(pending[0]!.id)
        expect(at - Date.now()).toBeGreaterThan(24 * 60 * 60 * 1000)
        const rejection = expect(ask).rejects.toThrow("rejected")
        await Permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        await rejection
      },
    })
  })

  test.each(["hook", "isolation_escalation", "ops_approve", "computer"])(
    "%s receives the same 15-second countdown in minimal-interaction mode",
    async (permission) => {
      vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
      vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
      vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "")
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const before = Date.now()
          const ask = Permission.ask({
            sessionID: SessionID.make("ses_idle_once_all"),
            permission,
            patterns: ["test-action"],
            metadata: { requireInteractive: true },
            always: [],
            ruleset: [],
          })
          const [pending] = await waitForPending()
          expect(pending.autoOnceAt).toBeGreaterThanOrEqual(before + 15_000)
          expect(pending.autoOnceAt).toBeLessThanOrEqual(Date.now() + 15_000)
          await Permission.reply({ requestID: pending.id, reply: "once" })
          await ask
        },
      })
    },
  )

  test.each(["auto", "sandbox", "webmcp"])("turning off eligibility (%s) cancels an armed countdown", async (gate) => {
    armedEnv()
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "500")
    let connected = true
    vi.spyOn(MCP, "isWebMcpConnected").mockImplementation((name) => name === "bridge" && connected)
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: (number | undefined)[] = []
        const unsubscribe = Bus.subscribe(Permission.Event.Asked, (event) => events.push(event.properties.autoOnceAt))
        try {
          const ask = Permission.ask({
            sessionID: SessionID.make("ses_idle_once_cancel"),
            permission: "webmcp",
            patterns: ["list_pages"],
            metadata: { server: "bridge" },
            always: [],
            ruleset: [],
          })
          const [pending] = await waitForPending()
          expect(pending.autoOnceAt).toBeTypeOf("number")
          if (gate === "auto") vi.stubEnv("AX_CODE_AUTONOMOUS", "0")
          if (gate === "sandbox") vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
          if (gate === "webmcp") connected = false
          await sleep(650)
          const [remaining] = await Permission.list()
          expect(remaining?.id).toBe(pending.id)
          expect(remaining.autoOnceAt).toBeUndefined()
          expect(events.at(-1)).toBeUndefined()
          await Permission.reply({ requestID: pending.id, reply: "once" })
          await ask
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test.each([undefined, "off", "other"])("WebMCP requires its own connected bridge (%s)", async (server) => {
    armedEnv()
    vi.spyOn(MCP, "isWebMcpConnected").mockImplementation((name) => name === "bridge")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = Permission.ask({
          sessionID: SessionID.make("ses_idle_once_off_bridge"),
          permission: "webmcp",
          patterns: ["list_pages"],
          metadata: { server },
          always: [],
          ruleset: [],
        })
        const [pending] = await waitForPending()
        expect(pending.autoOnceAt).toBeUndefined()
        await sleep(100)
        expect(await Permission.list()).toHaveLength(1)
        await Permission.reply({ requestID: pending.id, reply: "once" })
        await ask
      },
    })
  })

  test("a pending external-directory request starts its countdown after sandbox is switched off", async () => {
    armedEnv()
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "300")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = Permission.ask({
          sessionID: SessionID.make("ses_idle_once_external"),
          permission: "external_directory",
          patterns: ["/outside/fixture"],
          metadata: { requireInteractive: true },
          always: [],
          ruleset: [],
        })
        const [pending] = await waitForPending()
        expect(pending.autoOnceAt).toBeUndefined()
        vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
        await waitForAutoOnceAt(pending.id)
        await ask
        expect(await Permission.list()).toEqual([])
      },
    })
  })
  test("a new explicit deny cancels an already armed countdown", async () => {
    armedEnv()
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "500")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ruleset: Permission.Ruleset = []
        const ask = Permission.ask({
          sessionID: SessionID.make("ses_idle_once_new_deny"),
          permission: "hook",
          patterns: ["test-action"],
          metadata: {},
          always: [],
          ruleset,
        })
        const [pending] = await waitForPending()
        expect(pending.autoOnceAt).toBeTypeOf("number")
        ruleset.push({ permission: "hook", pattern: "*", action: "deny" })
        await sleep(650)
        const [remaining] = await Permission.list()
        expect(remaining?.id).toBe(pending.id)
        expect(remaining.autoOnceAt).toBeUndefined()
        const rejection = expect(ask).rejects.toThrow("rejected")
        await Permission.reply({ requestID: pending.id, reply: "reject" })
        await rejection
      },
    })
  })

  test("abort promotes the next request with a fresh countdown", async () => {
    armedEnv()
    vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "300")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const abort = new AbortController()
        const input = {
          sessionID: SessionID.make("ses_idle_once_abort_queue"),
          permission: "hook",
          patterns: ["test-action"],
          metadata: {},
          always: [],
          ruleset: [],
        }
        const first = Permission.ask(input, { signal: abort.signal })
        const [head] = await waitForPending()
        const second = Permission.ask(input)
        await vi.waitFor(async () => expect(await Permission.list()).toHaveLength(2))
        const tail = (await Permission.list()).find((item) => item.id !== head.id)!
        expect(tail.autoOnceAt).toBeUndefined()
        const rejection = expect(first).rejects.toBeDefined()
        abort.abort()
        await rejection
        expect(await waitForAutoOnceAt(tail.id)).toBeGreaterThan(Date.now())
        await second
        expect(await Permission.list()).toEqual([])
      },
    })
  })
})
