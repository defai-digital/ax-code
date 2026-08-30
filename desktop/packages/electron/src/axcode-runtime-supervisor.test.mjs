import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  createAxCodeRuntimeSupervision,
  resolveRuntimeBinary,
  RUNTIME_READINESS,
} = require("./axcode-runtime-supervisor.js")
const { createSupervisionFsm } = require("./supervision-fsm.js")

const TEST_PASSWORD = "test-runtime-password"
const RESERVED_PORT = 45999
const FIXED_ORIGIN = `http://127.0.0.1:${RESERVED_PORT}`

// Deterministic clock, same shape as the FSM test's fake clock.
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
  }
}

function createFakeChild(pid = 4321) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = pid
  child.exitCode = null
  child.signalCode = null
  child.killSignals = []
  child.kill = (signal) => {
    child.killSignals.push(signal || "SIGTERM")
    return true
  }
  child.emitExit = (code, signal = null) => {
    child.exitCode = code
    child.signalCode = signal
    child.emit("exit", code, signal)
  }
  child.emitListening = (origin = FIXED_ORIGIN) => {
    child.stdout.emit("data", Buffer.from(`ax-code server listening on ${origin}\n`))
  }
  return child
}

function createFakeSpawn() {
  const calls = []
  const children = []
  const spawn = (command, args, options) => {
    const child = createFakeChild(4321 + children.length)
    calls.push({ command, args, options })
    children.push(child)
    return child
  }
  return { spawn, calls, children }
}

function createFakeFetch(queue = []) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} })
    const next = queue.length > 0 ? queue.shift() : { ok: true, body: { healthy: true } }
    if (next.error) throw next.error
    return {
      ok: next.ok,
      status: next.ok ? 200 : 503,
      json: async () => next.body,
      body: { cancel() {} },
    }
  }
  return { fetch, calls, queue }
}

function createLogger() {
  const logs = []
  const warns = []
  const errors = []
  return {
    logs,
    warns,
    errors,
    logger: {
      log: (...args) => logs.push(args.join(" ")),
      warn: (...args) => warns.push(args.join(" ")),
      error: (...args) => errors.push(args.join(" ")),
    },
  }
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

function createSupervision({ clock = createFakeClock(), fetchQueue = [], settings = {}, env = {}, ...rest } = {}) {
  const fakeSpawn = createFakeSpawn()
  const fakeFetch = createFakeFetch(fetchQueue)
  const { logger, logs, warns, errors } = createLogger()
  const originReports = []
  let fsmOptions = null
  const supervision = createAxCodeRuntimeSupervision({
    env: { PATH: "/usr/bin", ...env },
    settingsReader: () => settings,
    logger,
    onOriginChange: (origin, context) => originReports.push({ origin, ...context }),
    getPassword: () => TEST_PASSWORD,
    spawn: fakeSpawn.spawn,
    fetch: fakeFetch.fetch,
    isExecutable: (candidate) => candidate === "/custom/ax-code" || candidate === "/usr/bin/ax-code",
    probeVersion: () => "ax-code 7.7.9",
    reservePort: async () => RESERVED_PORT,
    fsmFactory: (options) => {
      fsmOptions = options
      return createSupervisionFsm({ ...options, clock })
    },
    // Keep unit tests fast: shorten the listening-line wait and stop timeouts.
    policy: { stopTermTimeoutMs: 10, stopKillTimeoutMs: 10 },
    ...rest,
  })
  return {
    supervision,
    clock,
    fakeSpawn,
    fakeFetch,
    fetchQueue: fakeFetch.queue,
    logs,
    warns,
    errors,
    originReports,
    getFsmOptions: () => fsmOptions,
  }
}

// Boot the supervision to healthy: spawn → listening line → first readiness
// probe succeeds. Returns the start() promise's resolved value.
async function startHealthy(ctx) {
  const started = ctx.supervision.start()
  await flushMicrotasks()
  expect(ctx.fakeSpawn.children).toHaveLength(1)
  ctx.fakeSpawn.children[0].emitListening()
  await flushMicrotasks() // listening line resolves spawn; readiness probe 1 fires
  await flushMicrotasks()
  const result = await started
  expect(ctx.supervision.state).toBe("healthy")
  return result
}

describe("resolveRuntimeBinary", () => {
  const isExecutable = (candidate) => candidate.startsWith("/exec/")

  test("settings.axCodeBinary wins over every other source", () => {
    const resolved = resolveRuntimeBinary({
      env: {
        AX_CODE_BINARY: "/exec/env-ax-code",
        AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/exec/bundled-ax-code",
        PATH: "/exec/bin",
      },
      settings: { axCodeBinary: "/exec/settings-ax-code" },
      isExecutable,
      platform: "darwin",
    })
    expect(resolved).toEqual({ binary: "/exec/settings-ax-code", source: "settings" })
  })

  test("explicit env vars come after settings and before the bundled binary", () => {
    const resolved = resolveRuntimeBinary({
      env: {
        AX_CODE_PATH: "/exec/env-ax-code",
        AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/exec/bundled-ax-code",
        PATH: "/exec/bin",
      },
      settings: { axCodeBinary: "/missing/settings-ax-code" },
      isExecutable,
      platform: "darwin",
    })
    expect(resolved).toEqual({ binary: "/exec/env-ax-code", source: "env" })
  })

  test("the bundled binary comes before PATH", () => {
    const resolved = resolveRuntimeBinary({
      env: { AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY: "/exec/bundled-ax-code", PATH: "/exec/bin" },
      settings: {},
      isExecutable,
      platform: "darwin",
    })
    expect(resolved).toEqual({ binary: "/exec/bundled-ax-code", source: "bundled" })
  })

  test("PATH lookup finds ax-code in a PATH directory", () => {
    const resolved = resolveRuntimeBinary({
      env: { PATH: ["/nope", "/exec/bin"].join(require("path").delimiter) },
      settings: {},
      isExecutable: (candidate) => candidate === require("path").join("/exec/bin", "ax-code"),
      platform: "darwin",
    })
    expect(resolved).toEqual({ binary: require("path").join("/exec/bin", "ax-code"), source: "path" })
  })

  test("on win32, PATH lookup prefers ax-code.exe / ax-code.cmd", () => {
    const path = require("path")
    // No drive-letter dir: the host path.delimiter is ":" on posix, which
    // would split "C:\..." — the preference order is what matters here.
    const resolved = resolveRuntimeBinary({
      env: { PATH: "/win/tools" },
      settings: {},
      isExecutable: (candidate) => candidate === path.join("/win/tools", "ax-code.cmd"),
      platform: "win32",
    })
    expect(resolved).toEqual({ binary: path.join("/win/tools", "ax-code.cmd"), source: "path" })
  })

  test("returns null when nothing executable is found", () => {
    expect(resolveRuntimeBinary({ env: { PATH: "/nope" }, settings: {}, isExecutable: () => false })).toBeNull()
  })
})

describe("ax-code runtime supervision", () => {
  test("start resolves the binary, spawns serve with the fixed port, and reports the origin", async () => {
    const ctx = createSupervision({ settings: { axCodeBinary: "/custom/ax-code" } })
    const result = await startHealthy(ctx)

    expect(result).toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    const call = ctx.fakeSpawn.calls[0]
    expect(call.command).toBe("/custom/ax-code")
    expect(call.args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", String(RESERVED_PORT)])
    expect(call.options.env.AX_CODE_SERVER_PASSWORD).toBe(TEST_PASSWORD)
    expect(ctx.logs.some((line) => line.includes("/custom/ax-code") && line.includes("ax-code 7.7.9"))).toBe(true)

    expect(ctx.supervision.origin).toBe(FIXED_ORIGIN)
    expect(ctx.supervision.port).toBe(RESERVED_PORT)
    expect(ctx.originReports).toEqual([{ origin: FIXED_ORIGIN, exhausted: false }])

    // The readiness health probe carries the Basic credential and never logs it.
    expect(ctx.fakeFetch.calls[0].url).toBe(`${FIXED_ORIGIN}/global/health`)
    const expectedAuth = `Basic ${Buffer.from(`ax-code:${TEST_PASSWORD}`).toString("base64")}`
    expect(ctx.fakeFetch.calls[0].headers.Authorization).toBe(expectedAuth)
    for (const line of [...ctx.logs, ...ctx.warns, ...ctx.errors]) {
      expect(line).not.toContain(TEST_PASSWORD)
    }
  })

  test("readiness succeeds on a later attempt after the listening line", async () => {
    const ctx = createSupervision({
      fetchQueue: [
        { ok: false, body: null },
        { ok: true, body: { healthy: false } },
        { ok: true, body: { healthy: true } },
      ],
    })
    const started = ctx.supervision.start()
    await flushMicrotasks()
    ctx.fakeSpawn.children[0].emitListening()
    await flushMicrotasks() // probe 1: HTTP not ok
    await flushMicrotasks()
    expect(ctx.supervision.state).toBe("booting")

    ctx.clock.advance(RUNTIME_READINESS.baseDelayMs) // probe 2: ok but healthy !== true
    await flushMicrotasks()
    expect(ctx.supervision.state).toBe("booting")

    ctx.clock.advance(RUNTIME_READINESS.baseDelayMs * 2) // probe 3: healthy
    await flushMicrotasks()
    await expect(started).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    expect(ctx.supervision.state).toBe("healthy")
    expect(ctx.fakeFetch.calls).toHaveLength(3)
  })

  test("a missing binary rejects start() before any spawn", async () => {
    const { logger } = createLogger()
    const fakeSpawn = createFakeSpawn()
    const supervision = createAxCodeRuntimeSupervision({
      env: { PATH: "/nope" },
      settingsReader: () => ({}),
      logger,
      spawn: fakeSpawn.spawn,
      isExecutable: () => false,
      reservePort: async () => RESERVED_PORT,
    })
    await expect(supervision.start()).rejects.toThrow(/could not find the ax-code CLI/)
    expect(supervision.state).toBe("idle")
    expect(fakeSpawn.calls).toHaveLength(0)
  })

  test("an exit before the listening line fails the initial start via wire.exited", async () => {
    const ctx = createSupervision()
    const started = ctx.supervision.start()
    await flushMicrotasks()
    ctx.fakeSpawn.children[0].stderr.emit("data", Buffer.from("boom\n"))
    ctx.fakeSpawn.children[0].emitExit(3)
    await expect(started).rejects.toThrow("ax-code-runtime process exited before ready (code 3)")
    expect(ctx.supervision.state).toBe("idle")
    // The captured stderr was forwarded to the log for diagnostics.
    expect(ctx.errors.some((line) => line.includes("boom"))).toBe(true)
    // Initial-start failure: no recovery loop, no budget consumed.
    ctx.clock.advance(600_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.calls).toHaveLength(1)
  })

  test("a missing listening line times out, kills the child, and rejects start()", async () => {
    const ctx = createSupervision({ listeningTimeoutMs: 20 })
    const started = ctx.supervision.start()
    await flushMicrotasks()
    await expect(started).rejects.toThrow(/did not report its listening address within 20ms/)
    expect(ctx.fakeSpawn.children[0].killSignals).toContain("SIGKILL")
    expect(ctx.supervision.state).toBe("idle")
  })

  test("FSM crash recovery respawns on the SAME fixed port and re-reports the origin", async () => {
    const ctx = createSupervision()
    await startHealthy(ctx)

    ctx.fakeSpawn.children[0].emitExit(1)
    expect(ctx.originReports.at(-1)).toEqual({ origin: null, exhausted: false })
    ctx.clock.advance(0) // backoff 0 → respawn
    await flushMicrotasks()
    expect(ctx.fakeSpawn.calls).toHaveLength(2)
    expect(ctx.fakeSpawn.calls[1].args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", String(RESERVED_PORT)])

    ctx.fakeSpawn.children[1].emitListening()
    await flushMicrotasks()
    await flushMicrotasks()
    expect(ctx.supervision.state).toBe("healthy")
    expect(ctx.originReports.at(-1)).toEqual({ origin: FIXED_ORIGIN, exhausted: false })
  })

  test("liveness probe failures terminate the wedged runtime and restart it", async () => {
    const ctx = createSupervision({
      liveness: { intervalMs: 1_000, timeoutMs: 5_000, maxConsecutiveFailures: 2 },
    })
    await startHealthy(ctx)
    const fsmOptions = ctx.getFsmOptions()
    expect(fsmOptions.probe).toMatchObject({ intervalMs: 1_000, timeoutMs: 5_000, maxConsecutiveFailures: 2 })

    // Two consecutive failing health checks → wedged kill + crash recovery.
    ctx.fetchQueue.push({ ok: false, body: null }, { ok: false, body: null })
    ctx.fakeFetch.calls.length = 0
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    await flushMicrotasks()

    expect(ctx.fakeSpawn.children[0].killSignals).toContain("SIGKILL")
    expect(ctx.supervision.state).toBe("restarting")
    // Every probe hit /global/health with auth.
    for (const call of ctx.fakeFetch.calls) {
      expect(call.url).toBe(`${FIXED_ORIGIN}/global/health`)
    }
  })

  test("exhaustion reports diagnostics with binary, version, and exit code — never the password", async () => {
    const ctx = createSupervision({
      policy: { maxCrashRestarts: 1, stopTermTimeoutMs: 10, stopKillTimeoutMs: 10 },
    })
    await startHealthy(ctx)

    // Crash: one allowed restart (attempt 1), which crashes during boot; the
    // next attempt is blocked → exhausted.
    ctx.fakeSpawn.children[0].emitExit(2)
    ctx.clock.advance(0)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children).toHaveLength(2)
    ctx.fakeSpawn.children[1].emitExit(3)
    ctx.clock.advance(500) // backoff after attempt 1 → budget blocked
    await flushMicrotasks()

    expect(ctx.supervision.state).toBe("exhausted")
    const report = ctx.originReports.at(-1)
    expect(report.origin).toBeNull()
    expect(report.exhausted).toBe(true)
    expect(report.diagnostics).toMatchObject({
      binarySource: "path",
      version: "ax-code 7.7.9",
      exitCode: 3,
    })
    expect(report.diagnostics.binary).toBe(require("path").join("/usr/bin", "ax-code"))
    expect(JSON.stringify(report.diagnostics)).not.toContain(TEST_PASSWORD)
  })

  test("env AX_CODE_PORT is used as the fixed port without reserving one", async () => {
    let reserveCalls = 0
    const ctx = createSupervision({
      env: { AX_CODE_PORT: "46789" },
      reservePort: async () => {
        reserveCalls += 1
        return RESERVED_PORT
      },
    })
    const started = ctx.supervision.start()
    await flushMicrotasks()
    ctx.fakeSpawn.children[0].emitListening("http://127.0.0.1:46789")
    await flushMicrotasks()
    await flushMicrotasks()
    await expect(started).resolves.toEqual({ port: 46789, origin: "http://127.0.0.1:46789" })
    expect(reserveCalls).toBe(0)
    expect(ctx.fakeSpawn.calls[0].args).toContain("46789")
  })

  test("stop() runs SIGTERM then resolves when the runtime exits; no restart follows", async () => {
    const ctx = createSupervision()
    await startHealthy(ctx)

    const stopped = ctx.supervision.stop()
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toEqual(["SIGTERM"])
    ctx.fakeSpawn.children[0].emitExit(0)
    await stopped
    expect(ctx.supervision.state).toBe("stopped")

    ctx.clock.advance(600_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.calls).toHaveLength(1)
    expect(ctx.supervision.state).toBe("stopped")
  })

  test("stop() escalates to SIGKILL when SIGTERM is ignored", async () => {
    const ctx = createSupervision()
    await startHealthy(ctx)

    const stopped = ctx.supervision.stop()
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toEqual(["SIGTERM"])
    // No exit: the driver's real 10 ms term timeout escalates.
    await stopped
    expect(ctx.fakeSpawn.children[0].killSignals).toEqual(["SIGTERM", "SIGKILL"])
    expect(ctx.supervision.state).toBe("stopped")
  })
})
