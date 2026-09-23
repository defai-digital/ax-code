import { afterEach, describe, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import fs from "fs/promises"
import path from "path"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

// ADR-138: an opt-in idle "Allow once" — full-access + autonomous +
// allowlisted interactive permission + head-of-queue gets a server-side
// deadline that auto-replies "once"; any human reply cancels it. The tests
// use the AX_CODE_PERMISSION_IDLE_ONCE_MS debug override with real timers.
afterEach(async () => {
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

  test("only the head-of-queue ask for a session gets the deadline", async () => {
    armedEnv()
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
        const tailNow = (await Permission.list())[0]!
        const tailRejection = expect(second).rejects.toThrow("rejected")
        await Permission.reply({ requestID: tailNow.id, reply: "reject" })
        await tailRejection
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

  test("stays off without the opt-in config", async () => {
    armedEnv()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_optin")
        const ask = askDestructive(sessionID, "rm -rf /tmp/opt")
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

  test("never-auto permissions cannot be configured into the allowlist", async () => {
    armedEnv()
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: { permission_idle_once: { enabled: true, timeout_ms: 5_000, permissions: ["hook"] } },
      } as never,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_idle_once_hook")
        const ask = Permission.ask({
          sessionID,
          permission: "hook",
          patterns: ["bash"],
          metadata: { reason: "hook author asked" },
          always: [],
          ruleset: [],
        })
        const pending = await waitForPending()
        expect(pending[0]!.autoOnceAt).toBeUndefined()
        const rejection = expect(ask).rejects.toThrow("rejected")
        await Permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        await rejection
      },
    })
  })
})
