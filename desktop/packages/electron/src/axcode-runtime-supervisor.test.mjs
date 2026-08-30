import { EventEmitter } from "node:events"
import childProcess from "node:child_process"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  createAxCodeRuntimeSupervision,
  resolveRuntimeBinary,
  resolveSpawnInvocation,
  computeInitialStartRetryDelayMs,
  RUNTIME_READINESS,
  START_RETRY,
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
    // Keep unit tests fast: shorten the listening-line wait and stop
    // timeouts, and disable the initial-start retry (fix-2 tests opt back in
    // with their own startRetry config).
    policy: { stopTermTimeoutMs: 10, stopKillTimeoutMs: 10 },
    startRetry: { maxAttempts: 1 },
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
    expect(ctx.logs.some((line) => line.includes("/custom/ax-code") && line.includes("source: settings"))).toBe(true)
    // The version probe is async (off prepare()'s critical path): the version
    // lands in a follow-up log line and on the diagnostics payload.
    await flushMicrotasks()
    expect(ctx.logs.some((line) => line.includes("ax-code 7.7.9"))).toBe(true)

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

  test("prepare() resolves the binary and reserves the fixed port WITHOUT spawning (S2.5b parallel boot)", async () => {
    const ctx = createSupervision({ settings: { axCodeBinary: "/custom/ax-code" } })

    const prepared = await ctx.supervision.prepare()
    expect(prepared).toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    expect(ctx.supervision.port).toBe(RESERVED_PORT)
    // No spawn, no FSM: prepare is the pre-boot half only.
    expect(ctx.fakeSpawn.calls).toHaveLength(0)
    expect(ctx.supervision.state).toBe("idle")

    // prepare() is idempotent and start() reuses the prepared port/origin.
    await expect(ctx.supervision.prepare()).resolves.toEqual(prepared)
    const result = await startHealthy(ctx)
    expect(result).toEqual(prepared)
    expect(ctx.fakeSpawn.calls[0].args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", String(RESERVED_PORT)])
  })

  test("a missing binary rejects prepare() before any spawn, and prepare() may be retried", async () => {
    const settings = {}
    const ctx = createSupervision({ settings, isExecutable: (candidate) => candidate === "/custom/ax-code" })

    await expect(ctx.supervision.prepare()).rejects.toThrow(/could not find the ax-code CLI/)
    expect(ctx.fakeSpawn.calls).toHaveLength(0)
    expect(ctx.supervision.port).toBe(0)

    settings.axCodeBinary = "/custom/ax-code"
    await expect(ctx.supervision.prepare()).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
  })

  test("a reservePort failure does NOT pin prepare(); a retry re-reserves", async () => {
    let reserveCalls = 0
    const ctx = createSupervision({
      settings: { axCodeBinary: "/custom/ax-code" },
      reservePort: async () => {
        reserveCalls += 1
        if (reserveCalls === 1) throw new Error("EADDRINUSE")
        return RESERVED_PORT
      },
    })

    await expect(ctx.supervision.prepare()).rejects.toThrow("EADDRINUSE")
    // Previously this stayed pinned forever because only the binary
    // resolution was checked; now only a fully successful prepare is pinned.
    await expect(ctx.supervision.prepare()).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    expect(reserveCalls).toBe(2)
  })
})

describe("resolveSpawnInvocation", () => {
  test("passes the binary through on non-Windows platforms", () => {
    expect(resolveSpawnInvocation("/usr/bin/ax-code", ["serve"], "darwin", {})).toEqual({
      command: "/usr/bin/ax-code",
      args: ["serve"],
      windowsVerbatimArguments: false,
    })
  })

  test("passes non-.cmd binaries through on win32", () => {
    const result = resolveSpawnInvocation("C:\\tools\\ax-code.exe", ["--version"], "win32", {})
    expect(result.command).toBe("C:\\tools\\ax-code.exe")
    expect(result.args).toEqual(["--version"])
    expect(result.windowsVerbatimArguments).toBe(false)
  })

  test("wraps .cmd launchers in ComSpec on win32 with verbatim arguments", () => {
    const result = resolveSpawnInvocation("C:\\tools\\ax-code.cmd", ["serve", "--port", "4096"], "win32", {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    })
    expect(result.command).toBe("C:\\Windows\\System32\\cmd.exe")
    expect(result.args).toEqual(["/d", "/s", "/c", '"C:\\tools\\ax-code.cmd" serve --port 4096'])
    expect(result.windowsVerbatimArguments).toBe(true)
  })

  test("honors COMSPEC when ComSpec is unset and falls back to cmd.exe", () => {
    const upper = resolveSpawnInvocation("C:\\a\\ax-code.bat", [], "win32", { COMSPEC: "D:\\cmd.exe" })
    expect(upper.command).toBe("D:\\cmd.exe")
    const fallback = resolveSpawnInvocation("C:\\a\\ax-code.cmd", [], "win32", {})
    expect(fallback.command).toBe("cmd.exe")
  })
})

describe("initial-start retry", () => {
  test("computeInitialStartRetryDelayMs produces the 5s -> 15s capped schedule", () => {
    expect([1, 2, 3].map((attempt) => computeInitialStartRetryDelayMs(attempt))).toEqual([5_000, 15_000, 15_000])
    expect(START_RETRY).toMatchObject({ maxAttempts: 3, baseDelayMs: 5_000, capDelayMs: 15_000 })
  })

  test("a failed initial boot is retried and can recover on a later attempt", async () => {
    const ctx = createSupervision({ startRetry: { maxAttempts: 3, baseDelayMs: 5, capDelayMs: 15 } })
    const started = ctx.supervision.start()
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children).toHaveLength(1)

    ctx.fakeSpawn.children[0].emitExit(1)
    await flushMicrotasks()
    await new Promise((resolve) => setTimeout(resolve, 30)) // outlast the 5 ms retry backoff
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children).toHaveLength(2)
    expect(ctx.warns.some((line) => line.includes("initial start attempt 1/3 failed"))).toBe(true)

    ctx.fakeSpawn.children[1].emitListening()
    await flushMicrotasks()
    await flushMicrotasks()
    await expect(started).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    expect(ctx.supervision.state).toBe("healthy")
  })

  test("gives up after the configured attempts and rejects with the last boot error", async () => {
    const ctx = createSupervision({ startRetry: { maxAttempts: 3, baseDelayMs: 1, capDelayMs: 2 } })
    const started = ctx.supervision.start()
    const assertion = expect(started).rejects.toThrow("exited before ready (code 1)")

    await flushMicrotasks()
    ctx.fakeSpawn.children[0].emitExit(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children).toHaveLength(2)
    ctx.fakeSpawn.children[1].emitExit(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children).toHaveLength(3)
    ctx.fakeSpawn.children[2].emitExit(1)

    await assertion
    expect(ctx.supervision.state).toBe("idle")
    // No further retries after the final attempt.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children).toHaveLength(3)
  })

  test("stop() during the retry backoff cancels the pending retry", async () => {
    const ctx = createSupervision({ startRetry: { maxAttempts: 3, baseDelayMs: 30_000, capDelayMs: 60_000 } })
    const started = ctx.supervision.start()
    const assertion = expect(started).rejects.toThrow("exited before ready (code 1)")
    await flushMicrotasks()
    ctx.fakeSpawn.children[0].emitExit(1)
    await flushMicrotasks() // first attempt failed; the 30 s backoff is pending

    await ctx.supervision.stop()
    await assertion
    expect(ctx.supervision.state).toBe("stopped")
    // The retry was cancelled: no second spawn even after real time passes.
    await new Promise((resolve) => setTimeout(resolve, 25))
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children).toHaveLength(1)
  })
})

describe("spawn-window orphan protection", () => {
  test("stop() during the spawn window kills a spawned child that never reported listening (real child_process)", async () => {
    const realChildren = []
    const { logger } = createLogger()
    const supervision = createAxCodeRuntimeSupervision({
      env: { PATH: "/usr/bin" },
      settingsReader: () => ({}),
      logger,
      getPassword: () => TEST_PASSWORD,
      // Real child_process semantics: a process that never prints the
      // listening line, so the FSM never receives a handle.
      spawn: () => {
        const child = childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        realChildren.push(child)
        return child
      },
      isExecutable: (candidate) => candidate === "/usr/bin/ax-code",
      probeVersion: () => null,
      reservePort: async () => RESERVED_PORT,
      startRetry: { maxAttempts: 1 },
      listeningTimeoutMs: 30_000,
      fsmFactory: (options) => createSupervisionFsm(options),
    })

    const started = supervision.start()
    const assertion = expect(started).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 100)) // let the real spawn settle
    expect(realChildren).toHaveLength(1)
    const exited = new Promise((resolve) => realChildren[0].once("exit", (code, signal) => resolve({ code, signal })))

    await supervision.stop()
    const { signal } = await exited
    // The child existed but the FSM never saw a handle; stop() still killed it.
    expect(signal).toBe("SIGKILL")
    await assertion
    expect(supervision.state).toBe("stopped")
  })

  test("stop() before start() finishes prepare() prevents any spawn", async () => {
    let releasePort
    const portGate = new Promise((resolve) => {
      releasePort = () => resolve(RESERVED_PORT)
    })
    const ctx = createSupervision({ reservePort: () => portGate })

    const started = ctx.supervision.start()
    const assertion = expect(started).rejects.toThrow(/cancelled by stop/)
    // stop() lands while start() is still awaiting the port reservation
    // (the FSM is not even assigned yet).
    const stopPromise = ctx.supervision.stop()
    releasePort()
    await stopPromise
    await assertion
    expect(ctx.fakeSpawn.calls).toHaveLength(0)
    expect(ctx.supervision.state).toBe("idle")
  })
})

describe("listening line parsing", () => {
  test("a listening line on a different port than requested is a boot failure (kill + reject)", async () => {
    const ctx = createSupervision()
    const started = ctx.supervision.start()
    const assertion = expect(started).rejects.toThrow(/listened on port 46000 but port 45999 was requested/)
    await flushMicrotasks()
    ctx.fakeSpawn.children[0].emitListening("http://127.0.0.1:46000")
    await assertion
    // The mismatched child is killed: accepting its port would boot
    // "healthy" while fixedOrigin/web env 503 every request.
    expect(ctx.fakeSpawn.children[0].killSignals).toContain("SIGKILL")
    expect(ctx.supervision.state).toBe("idle")
  })

  test("the listening line parses through ANSI escapes and log prefixes", async () => {
    const ctx = createSupervision()
    const started = ctx.supervision.start()
    await flushMicrotasks()
    ctx.fakeSpawn.children[0].stdout.emit(
      "data",
      Buffer.from(`[32m2026-08-29T00:00:00Z INFO ax-code server listening on http://127.0.0.1:${RESERVED_PORT}[0m\n`),
    )
    await flushMicrotasks()
    await flushMicrotasks()
    await expect(started).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    expect(ctx.supervision.state).toBe("healthy")
  })
})

describe("busy-session restart grace", () => {
  test("the wedged kill is deferred while sessions are busy; the kill proceeds after the grace", async () => {
    const ctx = createSupervision({
      liveness: { intervalMs: 1_000, timeoutMs: 5_000, maxConsecutiveFailures: 1 },
      busyDeferralGraceMs: 2_000,
    })
    await startHealthy(ctx)
    // No busy signal ever received: count is 0, no deferral.
    expect(ctx.getFsmOptions().probe.shouldDeferRestart()).toBe(false)
    ctx.supervision.setActiveSessionCount(3)
    expect(ctx.getFsmOptions().probe.shouldDeferRestart()).toBe(true)

    // Every liveness probe fails; threshold 1 → deferral starts at +1000,
    // grace 2000 ms → the kill lands at +3000.
    ctx.fetchQueue.push(
      { ok: false, body: null },
      { ok: false, body: null },
      { ok: false, body: null },
      { ok: false, body: null },
    )
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toHaveLength(0)
    expect(ctx.supervision.state).toBe("healthy")
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toHaveLength(0)
    expect(ctx.supervision.state).toBe("healthy")
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toContain("SIGKILL")
    expect(ctx.supervision.state).toBe("restarting")
  })

  test("sessions draining to zero lets the wedged kill proceed immediately", async () => {
    const ctx = createSupervision({
      liveness: { intervalMs: 1_000, timeoutMs: 5_000, maxConsecutiveFailures: 1 },
      busyDeferralGraceMs: 60_000,
    })
    await startHealthy(ctx)
    ctx.supervision.setActiveSessionCount(2)
    ctx.fetchQueue.push({ ok: false, body: null }, { ok: false, body: null })
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toHaveLength(0) // deferred

    ctx.supervision.setActiveSessionCount(0)
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toContain("SIGKILL")
    expect(ctx.supervision.state).toBe("restarting")
  })

  test("no busy signal (default count 0) kills immediately at the threshold", async () => {
    const ctx = createSupervision({
      liveness: { intervalMs: 1_000, timeoutMs: 5_000, maxConsecutiveFailures: 1 },
      busyDeferralGraceMs: 60_000,
    })
    await startHealthy(ctx)
    ctx.fetchQueue.push({ ok: false, body: null })
    ctx.clock.advance(1_000)
    await flushMicrotasks()
    expect(ctx.fakeSpawn.children[0].killSignals).toContain("SIGKILL")
    expect(ctx.supervision.state).toBe("restarting")
  })
})

describe("supervision restart with re-resolution", () => {
  test("restart({ reprepare: true }) gracefully stops, re-resolves the binary, and restarts on the same port", async () => {
    const settings = { axCodeBinary: "/custom/ax-code" }
    const ctx = createSupervision({
      settings,
      isExecutable: (candidate) => ["/custom/ax-code", "/other/ax-code"].includes(candidate),
    })
    await startHealthy(ctx)
    expect(ctx.fakeSpawn.calls[0].command).toBe("/custom/ax-code")

    settings.axCodeBinary = "/other/ax-code"
    const restarted = ctx.supervision.restart({ reprepare: true })
    await flushMicrotasks()
    // Graceful stop of the old runtime first.
    expect(ctx.fakeSpawn.children[0].killSignals).toEqual(["SIGTERM"])
    ctx.fakeSpawn.children[0].emitExit(0)
    await flushMicrotasks()

    expect(ctx.fakeSpawn.calls).toHaveLength(2)
    expect(ctx.fakeSpawn.calls[1].command).toBe("/other/ax-code")
    // The fixed port is kept: the web fork env was pinned to it at boot.
    expect(ctx.fakeSpawn.calls[1].args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", String(RESERVED_PORT)])

    ctx.fakeSpawn.children[1].emitListening()
    await flushMicrotasks()
    await flushMicrotasks()
    await expect(restarted).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    expect(ctx.supervision.state).toBe("healthy")
    expect(ctx.originReports.at(-1)).toEqual({ origin: FIXED_ORIGIN, exhausted: false })
  })

  test("concurrent restart() calls share one in-flight restart", async () => {
    const ctx = createSupervision({ settings: { axCodeBinary: "/custom/ax-code" } })
    await startHealthy(ctx)

    const first = ctx.supervision.restart()
    const second = ctx.supervision.restart()
    await flushMicrotasks()
    ctx.fakeSpawn.children[0].emitExit(0)
    await flushMicrotasks()
    // One shared restart: exactly one graceful stop and one respawn.
    expect(ctx.fakeSpawn.calls).toHaveLength(2)
    ctx.fakeSpawn.children[1].emitListening()
    await flushMicrotasks()
    await flushMicrotasks()
    await expect(first).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    await expect(second).resolves.toEqual({ port: RESERVED_PORT, origin: FIXED_ORIGIN })
    expect(ctx.supervision.state).toBe("healthy")
  })
})
