import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { createSupervisionFsm, computeBackoffMs, computeReadinessDelayMs } = require("./supervision-fsm.js")

// Deterministic clock: timers are queued and fired by advance(), so the FSM's
// backoff/stability/boot timing is tested without real waits.
function createFakeClock(start = 1_000_000) {
  let current = start
  let seq = 0
  const timers = new Map()
  return {
    now: () => current,
    setTimeout: (fn, ms) => {
      const id = ++seq
      const handle = { id, unref() {} }
      timers.set(id, { fn, at: current + ms })
      return handle
    },
    clearTimeout: (handle) => {
      timers.delete(handle.id)
    },
    advance(ms) {
      const target = current + ms
      for (;;) {
        let next = null
        for (const [id, timer] of timers) {
          if (timer.at > target) continue
          if (!next || timer.at < next.at || (timer.at === next.at && id < next.id)) next = { id, ...timer }
        }
        if (!next) break
        current = next.at
        timers.delete(next.id)
        next.fn()
      }
      current = target
    },
    pendingCount: () => timers.size,
  }
}

function createFakeDriver() {
  const spawns = []
  const driver = {
    spawn(wire, context) {
      const child = { wire, context, terminated: 0, gracefulStops: [] }
      spawns.push(child)
      return child
    },
    terminate(handle) {
      handle.terminated += 1
    },
    gracefulStop(handle, timeouts) {
      handle.gracefulStops.push(timeouts)
      return Promise.resolve()
    },
  }
  return { driver, spawns }
}

const TEST_POLICY = {
  maxCrashRestarts: 5,
  stabilityWindowMs: 60_000,
  backoffBaseMs: 500,
  backoffCapMs: 5_000,
  bootTimeoutMs: 30_000,
  stopTermTimeoutMs: 5_000,
  stopKillTimeoutMs: 3_000,
}

function createFsm({ clock = createFakeClock(), driver = createFakeDriver(), ...overrides } = {}) {
  const events = []
  const exhausted = []
  const recovered = []
  const fsm = createSupervisionFsm({
    label: "server",
    policy: TEST_POLICY,
    clock,
    driver: driver.driver,
    onEvent: (event) => events.push(event),
    onExhausted: (error) => exhausted.push(error),
    onRecovered: (info) => recovered.push(info),
    ...overrides,
  })
  return { fsm, events, exhausted, recovered, clock, driver }
}

function stateChanges(events) {
  return events.filter((event) => event.type === "state-change").map((event) => `${event.from}->${event.to}`)
}

function backoffEvents(events) {
  return events.filter((event) => event.type === "restart-backoff")
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

async function startHealthy(fsm, driver, info = { port: 4096 }) {
  const started = fsm.start()
  driver.spawns[0].wire.ready(info)
  await expect(started).resolves.toEqual(info)
  expect(fsm.state).toBe("healthy")
  return started
}

describe("computeBackoffMs", () => {
  test("produces the capped exponential sequence", () => {
    const sequence = [1, 2, 3, 4, 5, 6].map((attempt) => computeBackoffMs(attempt, TEST_POLICY))
    expect(sequence).toEqual([500, 1000, 2000, 4000, 5000, 5000])
  })
})

describe("supervision FSM happy path", () => {
  test("spawn -> ready -> healthy with structured state-change events", async () => {
    const { fsm, events, driver, clock } = createFsm()

    const started = fsm.start()
    expect(fsm.state).toBe("booting")
    expect(driver.spawns).toHaveLength(1)
    expect(driver.spawns[0].context).toEqual({ restart: false, attempt: 0 })

    driver.spawns[0].wire.ready({ port: 4096 })
    await expect(started).resolves.toEqual({ port: 4096 })
    expect(fsm.state).toBe("healthy")
    expect(stateChanges(events)).toEqual([
      "idle->resolving",
      "resolving->spawning",
      "spawning->booting",
      "booting->healthy",
    ])
    for (const event of events) {
      expect(event.label).toBe("server")
      expect(Number.isFinite(event.at)).toBe(true)
    }

    // No crash: nothing else happens, even well past the boot timeout.
    clock.advance(120_000)
    expect(driver.spawns).toHaveLength(1)
    expect(fsm.state).toBe("healthy")
  })

  test("initial boot timeout rejects start() without touching the crash budget", async () => {
    const { fsm, driver, clock } = createFsm()

    const started = fsm.start()
    clock.advance(30_000)
    await expect(started).rejects.toThrow("server process start timed out")
    expect(fsm.state).toBe("idle")
    expect(fsm.crashRestarts).toBe(0)
    expect(driver.spawns[0].terminated).toBe(1)

    // The killed child's late exit is ignored: no recovery, no new spawns.
    driver.spawns[0].wire.exited(1)
    clock.advance(120_000)
    expect(driver.spawns).toHaveLength(1)
    expect(fsm.state).toBe("idle")
  })

  test("initial exit before ready rejects start() and does not recover", async () => {
    const { fsm, driver, clock } = createFsm()

    const started = fsm.start()
    driver.spawns[0].wire.exited(3)
    await expect(started).rejects.toThrow("server process exited before ready (code 3)")
    expect(fsm.state).toBe("idle")
    expect(fsm.crashRestarts).toBe(0)

    clock.advance(120_000)
    expect(driver.spawns).toHaveLength(1)
  })
})

describe("supervision FSM crash recovery", () => {
  test("a restart attempt that crashes before ready counts against the budget", async () => {
    const { fsm, events, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    driver.spawns[0].wire.exited(1)
    expect(fsm.state).toBe("restarting")
    clock.advance(0)
    expect(driver.spawns).toHaveLength(2)
    expect(fsm.crashRestarts).toBe(1)

    // Attempt 1 crashes before reporting ready: backoff 500 ms, then attempt 2.
    driver.spawns[1].wire.exited(1)
    const backoffs = backoffEvents(events)
    expect(backoffs).toHaveLength(1)
    expect(backoffs[0].attempt).toBe(1)
    expect(backoffs[0].backoffMs).toBe(500)
    expect(backoffs[0].error).toBe("server process exited before ready (code 1)")

    clock.advance(499)
    expect(driver.spawns).toHaveLength(2)
    clock.advance(1)
    expect(driver.spawns).toHaveLength(3)
    expect(fsm.crashRestarts).toBe(2)
  })

  test("restarts follow the 500/1000/2000/4000/5000 backoff sequence, then exhaust", async () => {
    const { fsm, events, exhausted, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    driver.spawns[0].wire.exited(1)
    clock.advance(0)

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const child = driver.spawns[attempt]
      expect(child.context).toEqual({ restart: true, attempt })
      child.wire.exited(1)
      const backoffs = backoffEvents(events)
      expect(backoffs).toHaveLength(attempt)
      expect(backoffs[attempt - 1].backoffMs).toBe(Math.min(500 * 2 ** (attempt - 1), 5000))
      clock.advance(backoffs[attempt - 1].backoffMs)
    }

    expect(fsm.state).toBe("exhausted")
    expect(fsm.crashRestarts).toBe(6)
    expect(exhausted).toHaveLength(1)
    expect(exhausted[0].message).toBe("server process exited before ready (code 1)")
    // 1 initial spawn + 5 restart attempts; the budget blocks the 6th.
    expect(driver.spawns).toHaveLength(6)

    // Exhausted is terminal: no further spawns or callbacks.
    clock.advance(600_000)
    expect(driver.spawns).toHaveLength(6)
    expect(exhausted).toHaveLength(1)
  })

  test("a successful restart reports recovery and resets the budget after 60 s of stability", async () => {
    const { fsm, events, recovered, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    driver.spawns[0].wire.exited(1)
    clock.advance(0)
    driver.spawns[1].wire.ready({ port: 4097 })
    expect(fsm.state).toBe("healthy")
    expect(recovered).toEqual([{ port: 4097 }])
    expect(fsm.crashRestarts).toBe(1)

    clock.advance(60_000)
    expect(events.some((event) => event.type === "stability-reset")).toBe(true)
    expect(fsm.crashRestarts).toBe(0)

    // The next crash restarts from a fresh budget (attempt 1, 500 ms backoff).
    driver.spawns[1].wire.exited(1)
    clock.advance(0)
    expect(fsm.crashRestarts).toBe(1)
    driver.spawns[2].wire.exited(1)
    expect(backoffEvents(events).at(-1).backoffMs).toBe(500)
  })

  test("a crash inside the stability window keeps the accumulated budget", async () => {
    const { fsm, events, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    driver.spawns[0].wire.exited(1)
    clock.advance(0)
    driver.spawns[1].wire.ready({ port: 4097 })
    expect(fsm.crashRestarts).toBe(1)

    // Crash at 59 s: the stability timer is cleared before it can reset.
    clock.advance(59_000)
    driver.spawns[1].wire.exited(1)
    clock.advance(0)
    expect(fsm.crashRestarts).toBe(2)
    driver.spawns[2].wire.exited(1)
    expect(backoffEvents(events).at(-1).backoffMs).toBe(1000)
  })

  test("a restart attempt that hits the boot timeout is terminated and retried", async () => {
    const { fsm, events, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    driver.spawns[0].wire.exited(1)
    clock.advance(0)
    expect(driver.spawns).toHaveLength(2)

    // Attempt 1 never reports ready: boot timeout kills it and backs off.
    clock.advance(30_000)
    expect(driver.spawns[1].terminated).toBe(1)
    const backoffs = backoffEvents(events)
    expect(backoffs).toHaveLength(1)
    expect(backoffs[0]).toMatchObject({ attempt: 1, backoffMs: 500, error: "server process start timed out" })

    // The killed child's late exit must not consume budget a second time.
    driver.spawns[1].wire.exited(1)
    expect(backoffEvents(events)).toHaveLength(1)

    clock.advance(500)
    expect(driver.spawns).toHaveLength(3)
    expect(fsm.crashRestarts).toBe(2)
  })
})

describe("supervision FSM stop", () => {
  test("stop during healthy runs the graceful stop sequence and never restarts", async () => {
    const { fsm, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    const stopped = fsm.stop()
    expect(fsm.state).toBe("stopping")
    await stopped
    expect(driver.spawns[0].gracefulStops).toEqual([{ termTimeoutMs: 5000, killTimeoutMs: 3000 }])
    expect(fsm.state).toBe("stopped")

    // The stopped child's exit triggers no recovery.
    driver.spawns[0].wire.exited(0)
    clock.advance(600_000)
    expect(driver.spawns).toHaveLength(1)
    expect(fsm.state).toBe("stopped")
  })

  test("stop during restarting cancels the pending restart", async () => {
    const { fsm, exhausted, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    driver.spawns[0].wire.exited(1)
    clock.advance(0)
    driver.spawns[1].wire.exited(1)
    expect(fsm.state).toBe("restarting")

    const stopped = fsm.stop()
    await stopped
    expect(fsm.state).toBe("stopped")

    // The backoff timer is cancelled: no further attempts, no exhaustion.
    clock.advance(600_000)
    expect(driver.spawns).toHaveLength(2)
    expect(exhausted).toHaveLength(0)
  })

  test("stop during the initial boot rejects start() and stops the child", async () => {
    const { fsm, driver, clock } = createFsm()

    const started = fsm.start()
    const assertion = expect(started).rejects.toThrow("server process stopped before ready")
    const stopped = fsm.stop()
    await stopped
    expect(driver.spawns[0].gracefulStops).toHaveLength(1)
    await assertion
    expect(fsm.state).toBe("stopped")

    clock.advance(600_000)
    expect(driver.spawns).toHaveLength(1)
  })

  test("stop is idempotent", async () => {
    const { fsm, driver } = createFsm()
    await startHealthy(fsm, driver)

    const first = fsm.stop()
    const second = fsm.stop()
    await Promise.all([first, second])
    expect(driver.spawns[0].gracefulStops).toHaveLength(1)
    expect(fsm.state).toBe("stopped")
  })
})

describe("supervision FSM health probe (optional driver)", () => {
  test("consecutive probe failures restart the process; single failures never do", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    let probeResults = [true]
    const { fsm, events } = createFsm({
      clock,
      driver: fake,
      probe: {
        intervalMs: 15_000,
        timeoutMs: 5_000,
        maxConsecutiveFailures: 3,
        check: () => Promise.resolve(probeResults.shift() ?? true),
      },
    })
    await startHealthy(fsm, fake)
    const { spawns } = fake

    // A single failure followed by a success resets the streak.
    probeResults = [false, true]
    clock.advance(15_000)
    await flushMicrotasks()
    clock.advance(15_000)
    await flushMicrotasks()
    clock.advance(15_000)
    await flushMicrotasks()
    expect(spawns).toHaveLength(1)
    expect(fsm.state).toBe("healthy")

    // Three consecutive failures reach the threshold: kill + crash recovery.
    probeResults = [false, false, false]
    clock.advance(15_000)
    await flushMicrotasks()
    clock.advance(15_000)
    await flushMicrotasks()
    expect(spawns).toHaveLength(1)
    clock.advance(15_000)
    await flushMicrotasks()

    expect(events.filter((event) => event.type === "health-probe-failed")).toHaveLength(4)
    expect(spawns[0].terminated).toBe(1)
    expect(fsm.state).toBe("restarting")
    clock.advance(0)
    expect(spawns).toHaveLength(2)
    expect(fsm.crashRestarts).toBe(1)

    // The killed child's exit is ignored; the replacement can boot normally.
    spawns[0].wire.exited(1)
    spawns[1].wire.ready({ port: 4100 })
    expect(fsm.state).toBe("healthy")
  })
})

describe("supervision FSM wire.failed", () => {
  test("an initial attempt that reports failed rejects start() without touching the crash budget", async () => {
    const { fsm, driver, clock } = createFsm()

    const started = fsm.start()
    driver.spawns[0].wire.failed(new Error("port 4096 is already in use"))
    await expect(started).rejects.toThrow("port 4096 is already in use")
    expect(fsm.state).toBe("idle")
    expect(fsm.crashRestarts).toBe(0)
    // A boot error means the process is still alive: no terminate.
    expect(driver.spawns[0].terminated).toBe(0)

    clock.advance(120_000)
    expect(driver.spawns).toHaveLength(1)
  })

  test("a restart attempt that reports failed is not terminated, and its following exit is not double-counted", async () => {
    const { fsm, events, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    driver.spawns[0].wire.exited(1)
    clock.advance(0)
    expect(driver.spawns).toHaveLength(2)

    // Mirrors server-process.js: an {type:"error"} message is followed by
    // process.exit(1). Only the failure counts against the budget.
    driver.spawns[1].wire.failed(new Error("EADDRINUSE"))
    expect(driver.spawns[1].terminated).toBe(0)
    const backoffs = backoffEvents(events)
    expect(backoffs).toHaveLength(1)
    expect(backoffs[0]).toMatchObject({ attempt: 1, backoffMs: 500, error: "EADDRINUSE" })

    driver.spawns[1].wire.exited(1)
    expect(backoffEvents(events)).toHaveLength(1)

    clock.advance(500)
    expect(driver.spawns).toHaveLength(3)
    expect(fsm.crashRestarts).toBe(2)
  })
})

describe("supervision FSM manual restart escape", () => {
  test("start() from exhausted restarts with a fresh budget", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    const exhaustedCalls = []
    const { fsm, events } = createFsm({
      clock,
      driver: fake,
      policy: { ...TEST_POLICY, maxCrashRestarts: 1 },
      onExhausted: (error, context) => exhaustedCalls.push({ error, context }),
    })
    await startHealthy(fsm, fake)

    // Exhaust the budget: one allowed restart, then the next attempt blocks.
    fake.spawns[0].wire.exited(1)
    clock.advance(0)
    fake.spawns[1].wire.exited(1)
    clock.advance(500)
    expect(fsm.state).toBe("exhausted")
    expect(exhaustedCalls).toHaveLength(1)
    expect(exhaustedCalls[0].error.message).toBe("server process exited before ready (code 1)")
    expect(exhaustedCalls[0].context).toMatchObject({ crashRestarts: 2, exitCode: 1 })

    // Manual escape: fresh budget, a new spawn, and normal recovery.
    const restarted = fsm.start()
    expect(fake.spawns).toHaveLength(3)
    expect(fake.spawns[2].context).toEqual({ restart: false, attempt: 0 })
    fake.spawns[2].wire.ready({ port: 4100 })
    await expect(restarted).resolves.toEqual({ port: 4100 })
    expect(fsm.state).toBe("healthy")
    expect(fsm.crashRestarts).toBe(0)

    fake.spawns[2].wire.exited(1)
    clock.advance(0)
    expect(fsm.crashRestarts).toBe(1)
    expect(events.some((event) => event.type === "state-change" && event.to === "exhausted")).toBe(true)
  })

  test("start() from stopped restarts with a fresh budget", async () => {
    const { fsm, driver, clock } = createFsm()
    await startHealthy(fsm, driver)

    await fsm.stop()
    expect(fsm.state).toBe("stopped")
    expect(driver.spawns[0].gracefulStops).toHaveLength(1)

    const restarted = fsm.start()
    expect(driver.spawns).toHaveLength(2)
    expect(driver.spawns[1].context).toEqual({ restart: false, attempt: 0 })
    driver.spawns[1].wire.ready({ port: 4101 })
    await expect(restarted).resolves.toEqual({ port: 4101 })
    expect(fsm.state).toBe("healthy")
    expect(fsm.crashRestarts).toBe(0)

    // A crash after the manual restart consumes budget from zero.
    driver.spawns[1].wire.exited(1)
    clock.advance(0)
    expect(fsm.crashRestarts).toBe(1)
    expect(driver.spawns).toHaveLength(3)
  })
})

describe("supervision FSM health probe failure modes", () => {
  const PROBE = { intervalMs: 1_000, timeoutMs: 5_000, maxConsecutiveFailures: 2 }

  test("a check that never resolves is counted as a failure via the probe timeout", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    const { fsm, events } = createFsm({
      clock,
      driver: fake,
      probe: { ...PROBE, check: () => new Promise(() => {}) },
    })
    await startHealthy(fsm, fake)

    clock.advance(1_000) // probe fires; check hangs
    clock.advance(5_000) // probe timeout resolves it as failed
    await flushMicrotasks()
    expect(events.filter((event) => event.type === "health-probe-failed")).toHaveLength(1)
    expect(fsm.state).toBe("healthy")

    // Second consecutive timeout reaches the threshold: wedged-process kill.
    clock.advance(1_000)
    clock.advance(5_000)
    await flushMicrotasks()
    expect(events.filter((event) => event.type === "health-probe-failed")).toHaveLength(2)
    expect(fake.spawns[0].terminated).toBe(1)
    expect(fsm.state).toBe("restarting")
    clock.advance(0)
    expect(fake.spawns).toHaveLength(2)
    expect(fsm.crashRestarts).toBe(1)
  })

  test("a rejecting check is counted as a failure", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    const { fsm, events } = createFsm({
      clock,
      driver: fake,
      probe: { ...PROBE, maxConsecutiveFailures: 3, check: () => Promise.reject(new Error("connection refused")) },
    })
    await startHealthy(fsm, fake)

    clock.advance(1_000)
    await flushMicrotasks()
    clock.advance(1_000)
    await flushMicrotasks()

    const failures = events.filter((event) => event.type === "health-probe-failed")
    expect(failures).toHaveLength(2)
    expect(failures[1].consecutiveFailures).toBe(2)
    expect(fsm.state).toBe("healthy")
    expect(fake.spawns).toHaveLength(1)
  })

  test("stop while a probe is in flight prevents any restart when it settles", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    const { fsm } = createFsm({
      clock,
      driver: fake,
      probe: { ...PROBE, maxConsecutiveFailures: 1, check: () => new Promise(() => {}) },
    })
    await startHealthy(fsm, fake)

    clock.advance(1_000) // probe fires and stays in flight
    const stopped = fsm.stop()
    await stopped
    expect(fsm.state).toBe("stopped")

    // The probe timeout fires after the stop: the stale result must be dropped.
    clock.advance(60_000)
    await flushMicrotasks()
    expect(fake.spawns).toHaveLength(1)
    expect(fake.spawns[0].terminated).toBe(0)
    expect(fsm.state).toBe("stopped")
  })
})

describe("supervision FSM probe config validation", () => {
  test("malformed probe values throw at construction", () => {
    const { driver } = createFakeDriver()
    const base = { intervalMs: 1_000, timeoutMs: 5_000, maxConsecutiveFailures: 2, check: () => true }
    expect(() => createSupervisionFsm({ driver, probe: { ...base, check: undefined } })).toThrow(/check/)
    expect(() => createSupervisionFsm({ driver, probe: { ...base, intervalMs: 0 } })).toThrow(/intervalMs/)
    expect(() => createSupervisionFsm({ driver, probe: { ...base, timeoutMs: -1 } })).toThrow(/timeoutMs/)
    expect(() => createSupervisionFsm({ driver, probe: { ...base, maxConsecutiveFailures: 1.5 } })).toThrow(
      /maxConsecutiveFailures/,
    )
    // A valid probe and no probe at all both construct fine.
    expect(() => createSupervisionFsm({ driver, probe: base })).not.toThrow()
    expect(() => createSupervisionFsm({ driver })).not.toThrow()
  })
})

describe("supervision FSM driver contract", () => {
  test("requires spawn, terminate, and gracefulStop driver functions", () => {
    expect(() => createSupervisionFsm({ driver: {} })).toThrow(TypeError)
    expect(() => createSupervisionFsm({ driver: { spawn() {} } })).toThrow(TypeError)
    expect(() => createSupervisionFsm({ driver: { spawn() {}, terminate() {} } })).toThrow(TypeError)
  })

  test("a spawn that throws synchronously fails the attempt", async () => {
    const clock = createFakeClock()
    const failing = {
      driver: {
        spawn() {
          throw new Error("fork failed")
        },
        terminate() {},
        gracefulStop: () => Promise.resolve(),
      },
      spawns: [],
    }
    const { fsm } = createFsm({ clock, driver: failing })
    await expect(fsm.start()).rejects.toThrow("fork failed")
    expect(fsm.state).toBe("idle")
  })
})

// Async spawn driver: spawn returns a promise the test settles by hand.
function createAsyncDriver() {
  const spawns = []
  const driver = {
    spawn(wire, context) {
      const child = { wire, context, terminated: 0, gracefulStops: [] }
      spawns.push(child)
      return new Promise((resolve, reject) => {
        child.settleSpawn = (handle = child) => resolve(handle)
        child.failSpawn = (error) => reject(error)
      })
    },
    terminate(handle) {
      handle.terminated += 1
    },
    gracefulStop(handle, timeouts) {
      handle.gracefulStops.push(timeouts)
      return Promise.resolve()
    },
  }
  return { driver, spawns }
}

describe("supervision FSM async spawn", () => {
  test("a resolved spawn promise enters booting and can become healthy", async () => {
    const clock = createFakeClock()
    const fake = createAsyncDriver()
    const { fsm, events } = createFsm({ clock, driver: fake })

    const started = fsm.start()
    expect(fsm.state).toBe("spawning")
    expect(fake.spawns).toHaveLength(1)

    fake.spawns[0].settleSpawn()
    await flushMicrotasks()
    expect(fsm.state).toBe("booting")

    fake.spawns[0].wire.ready({ port: 4096 })
    await expect(started).resolves.toEqual({ port: 4096 })
    expect(fsm.state).toBe("healthy")
    expect(stateChanges(events)).toEqual([
      "idle->resolving",
      "resolving->spawning",
      "spawning->booting",
      "booting->healthy",
    ])
  })

  test("a rejected spawn promise fails the initial start without touching the crash budget", async () => {
    const clock = createFakeClock()
    const fake = createAsyncDriver()
    const { fsm } = createFsm({ clock, driver: fake })

    const started = fsm.start()
    const assertion = expect(started).rejects.toThrow("binary not found")
    fake.spawns[0].failSpawn(new Error("binary not found"))
    await assertion
    expect(fsm.state).toBe("idle")
    expect(fsm.crashRestarts).toBe(0)

    clock.advance(120_000)
    expect(fake.spawns).toHaveLength(1)
  })

  test("a rejected spawn promise on a restart attempt counts against the budget", async () => {
    const clock = createFakeClock()
    const fake = createAsyncDriver()
    const { fsm, events } = createFsm({ clock, driver: fake })

    // wire.ready before the spawn promise settles: the readiness guard keeps
    // the attempt, and the late handle is attached without being terminated.
    const started = fsm.start()
    fake.spawns[0].wire.ready({ port: 4096 })
    fake.spawns[0].settleSpawn()
    await expect(started).resolves.toEqual({ port: 4096 })
    expect(fsm.state).toBe("healthy")
    expect(fake.spawns[0].terminated).toBe(0)

    fake.spawns[0].wire.exited(1)
    clock.advance(0)
    expect(fake.spawns).toHaveLength(2)

    fake.spawns[1].failSpawn(new Error("spawn blew up"))
    await flushMicrotasks()
    expect(fsm.state).toBe("restarting")
    const backoffs = backoffEvents(events)
    expect(backoffs).toHaveLength(1)
    expect(backoffs[0]).toMatchObject({ attempt: 1, backoffMs: 500, error: "spawn blew up" })

    clock.advance(500)
    expect(fake.spawns).toHaveLength(3)
    expect(fsm.crashRestarts).toBe(2)
  })

  test("stop during an in-flight spawn terminates the handle when the promise settles late", async () => {
    const clock = createFakeClock()
    const fake = createAsyncDriver()
    const { fsm } = createFsm({ clock, driver: fake })

    const started = fsm.start()
    const assertion = expect(started).rejects.toThrow("server process stopped before ready")
    const stopped = fsm.stop()
    await stopped
    expect(fsm.state).toBe("stopped")

    // The spawn promise settles after the stop: the late handle is killed so
    // no unsupervised process is left running.
    fake.spawns[0].settleSpawn()
    await flushMicrotasks()
    expect(fake.spawns[0].terminated).toBe(1)
    await assertion

    clock.advance(600_000)
    expect(fake.spawns).toHaveLength(1)
    expect(fsm.state).toBe("stopped")
  })

  test("the boot window covers the in-flight spawn; a late-settling handle is terminated", async () => {
    const clock = createFakeClock()
    const fake = createAsyncDriver()
    const { fsm } = createFsm({ clock, driver: fake })

    const started = fsm.start()
    const assertion = expect(started).rejects.toThrow("server process start timed out")
    clock.advance(30_000)
    await assertion
    expect(fsm.state).toBe("idle")
    expect(fsm.crashRestarts).toBe(0)

    fake.spawns[0].settleSpawn()
    await flushMicrotasks()
    expect(fake.spawns[0].terminated).toBe(1)

    clock.advance(600_000)
    expect(fake.spawns).toHaveLength(1)
    expect(fsm.state).toBe("idle")
  })
})

describe("supervision FSM boot readiness probing", () => {
  const READINESS = { maxAttempts: 10, baseDelayMs: 5_000, capDelayMs: 60_000 }

  test("computeReadinessDelayMs produces the capped exponential schedule", () => {
    const sequence = [1, 2, 3, 4, 5, 6, 7].map((attempt) => computeReadinessDelayMs(attempt, READINESS))
    expect(sequence).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000])
  })

  test("succeeds on the 3rd probe following the exact 5s/10s delay schedule", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    const probeCalls = []
    const results = [false, false, true]
    const { fsm, events } = createFsm({
      clock,
      driver: fake,
      readiness: {
        ...READINESS,
        probe: () => {
          probeCalls.push(clock.now())
          return Promise.resolve(results.shift() ?? true)
        },
      },
    })

    const started = fsm.start()
    expect(fsm.state).toBe("booting")
    await flushMicrotasks() // probe 1 runs immediately after entering booting
    expect(probeCalls).toEqual([1_000_000])

    clock.advance(4_999)
    await flushMicrotasks()
    expect(probeCalls).toHaveLength(1)

    clock.advance(1) // t=1_005_000: probe 2 after exactly baseDelayMs
    await flushMicrotasks()
    expect(probeCalls).toEqual([1_000_000, 1_005_000])

    clock.advance(10_000) // t=1_015_000: probe 3 after exactly 2*baseDelayMs
    await flushMicrotasks()
    expect(probeCalls).toEqual([1_000_000, 1_005_000, 1_015_000])

    // Readiness success carries wire.ready semantics with the handle as info.
    await expect(started).resolves.toBe(fake.spawns[0])
    expect(fsm.state).toBe("healthy")
    expect(events.filter((event) => event.type === "readiness-probe-failed")).toHaveLength(2)
    expect(fake.spawns[0].terminated).toBe(0)

    // No further probes once healthy.
    clock.advance(600_000)
    expect(probeCalls).toHaveLength(3)
  })

  test("a rejecting probe counts as a failed attempt and surfaces the error", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    const { fsm, events } = createFsm({
      clock,
      driver: fake,
      readiness: {
        ...READINESS,
        maxAttempts: 2,
        probe: () => Promise.reject(new Error("connection refused")),
      },
    })

    const started = fsm.start()
    const assertion = expect(started).rejects.toThrow("server process failed 2 readiness probes")
    await flushMicrotasks()
    clock.advance(5_000)
    await flushMicrotasks()
    await assertion

    const failures = events.filter((event) => event.type === "readiness-probe-failed")
    expect(failures).toHaveLength(2)
    expect(failures[0].error).toBe("connection refused")
    expect(fake.spawns[0].terminated).toBe(1)
    expect(fsm.state).toBe("idle")
    expect(fsm.crashRestarts).toBe(0)
  })

  test("exhaustion on a restart attempt terminates the process and counts against the crash budget", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    let probeResults = [true]
    const { fsm, events } = createFsm({
      clock,
      driver: fake,
      readiness: { ...READINESS, maxAttempts: 3, probe: () => Promise.resolve(probeResults.shift() ?? false) },
    })

    const started = fsm.start()
    await flushMicrotasks() // first probe succeeds immediately
    await expect(started).resolves.toBe(fake.spawns[0])
    expect(fsm.state).toBe("healthy")

    fake.spawns[0].wire.exited(1)
    clock.advance(0)
    expect(fake.spawns).toHaveLength(2)

    // Restart attempt: all 3 probes fail (at +0, +5s, +15s) → exhaustion.
    probeResults = [false, false, false]
    await flushMicrotasks()
    clock.advance(5_000)
    await flushMicrotasks()
    expect(fsm.state).toBe("booting")
    clock.advance(10_000)
    await flushMicrotasks()

    expect(events.filter((event) => event.type === "readiness-probe-failed")).toHaveLength(3)
    expect(fake.spawns[1].terminated).toBe(1)
    const backoffs = backoffEvents(events)
    expect(backoffs).toHaveLength(1)
    expect(backoffs[0]).toMatchObject({ attempt: 1, backoffMs: 500, error: "server process failed 3 readiness probes" })

    // The killed child's late exit must not consume budget a second time.
    fake.spawns[1].wire.exited(1)
    expect(backoffEvents(events)).toHaveLength(1)

    clock.advance(500)
    expect(fake.spawns).toHaveLength(3)
    expect(fsm.crashRestarts).toBe(2)
  })

  test("wire.ready inside a synchronous spawn skips readiness probing entirely", async () => {
    const clock = createFakeClock()
    let probeCalls = 0
    const readyDriver = {
      spawn(wire) {
        const child = { wire, terminated: 0, gracefulStops: [] }
        wire.ready({ port: 4096 })
        return child
      },
      terminate() {},
      gracefulStop: () => Promise.resolve(),
    }
    const { fsm } = createFsm({
      clock,
      driver: { driver: readyDriver, spawns: [] },
      readiness: {
        ...READINESS,
        probe: () => {
          probeCalls += 1
          return Promise.resolve(false)
        },
      },
    })

    await expect(fsm.start()).resolves.toEqual({ port: 4096 })
    expect(fsm.state).toBe("healthy")
    await flushMicrotasks()
    clock.advance(600_000)
    expect(probeCalls).toBe(0)
  })

  test("wire.ready during a readiness delay cancels the probe loop", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    const probeCalls = []
    const { fsm } = createFsm({
      clock,
      driver: fake,
      readiness: {
        ...READINESS,
        probe: () => {
          probeCalls.push(clock.now())
          return Promise.resolve(false)
        },
      },
    })

    const started = fsm.start()
    await flushMicrotasks() // probe 1 fails; probe 2 scheduled at +5s
    expect(probeCalls).toHaveLength(1)

    clock.advance(2_000)
    fake.spawns[0].wire.ready({ port: 4096 })
    await expect(started).resolves.toEqual({ port: 4096 })
    expect(fsm.state).toBe("healthy")

    clock.advance(600_000)
    await flushMicrotasks()
    expect(probeCalls).toHaveLength(1)
  })

  test("stop during a readiness delay cancels cleanly", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    let probeCalls = 0
    const { fsm, exhausted } = createFsm({
      clock,
      driver: fake,
      readiness: {
        ...READINESS,
        probe: () => {
          probeCalls += 1
          return Promise.resolve(false)
        },
      },
    })

    const started = fsm.start()
    const assertion = expect(started).rejects.toThrow("server process stopped before ready")
    await flushMicrotasks() // probe 1 fails; probe 2 pending
    expect(probeCalls).toBe(1)

    const stopped = fsm.stop()
    await stopped
    expect(fsm.state).toBe("stopped")
    expect(fake.spawns[0].gracefulStops).toHaveLength(1)
    await assertion

    clock.advance(600_000)
    await flushMicrotasks()
    expect(probeCalls).toBe(1)
    expect(fake.spawns).toHaveLength(1)
    expect(exhausted).toHaveLength(0)
  })

  test("stop while a readiness probe is in flight drops the late result", async () => {
    const clock = createFakeClock()
    const fake = createFakeDriver()
    let resolveProbe = null
    const { fsm } = createFsm({
      clock,
      driver: fake,
      readiness: { ...READINESS, probe: () => new Promise((resolve) => (resolveProbe = resolve)) },
    })

    const started = fsm.start()
    const assertion = expect(started).rejects.toThrow("server process stopped before ready")
    await flushMicrotasks() // probe 1 in flight
    expect(resolveProbe).not.toBeNull()

    const stopped = fsm.stop()
    await stopped
    expect(fsm.state).toBe("stopped")

    // The probe settles after the stop: no failure event, no restart.
    resolveProbe(false)
    await flushMicrotasks()
    clock.advance(600_000)
    expect(fake.spawns).toHaveLength(1)
    expect(fsm.state).toBe("stopped")
    await assertion
  })

  test("malformed readiness values throw at construction", () => {
    const { driver } = createFakeDriver()
    const base = { maxAttempts: 10, baseDelayMs: 5_000, capDelayMs: 60_000, probe: () => true }
    expect(() => createSupervisionFsm({ driver, readiness: { ...base, probe: undefined } })).toThrow(/probe/)
    expect(() => createSupervisionFsm({ driver, readiness: { ...base, maxAttempts: 0 } })).toThrow(/maxAttempts/)
    expect(() => createSupervisionFsm({ driver, readiness: { ...base, baseDelayMs: -1 } })).toThrow(/baseDelayMs/)
    expect(() => createSupervisionFsm({ driver, readiness: { ...base, capDelayMs: 1.5 } })).toThrow(/capDelayMs/)
    expect(() => createSupervisionFsm({ driver, readiness: base })).not.toThrow()
    expect(() => createSupervisionFsm({ driver })).not.toThrow()
  })
})
