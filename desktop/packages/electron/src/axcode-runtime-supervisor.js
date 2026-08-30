"use strict"

// ── Main-supervised ax-code runtime (S2.5a) ─────────────────────────────────
// SPEC-2026-08-29-desktop-process-model-collapse §5 S2.5: wires the unified
// supervision FSM (supervision-fsm.js) to the ax-code runtime process so the
// Electron main process can spawn/supervise it directly, gated behind
// AX_CODE_DESKTOP_SUPERVISE_RUNTIME (see main.js). When the flag is off this
// module is never loaded into a supervision role and the web server's own
// lifecycle keeps its current behavior.
//
// Design notes:
// - Binary resolution mirrors the web lifecycle's env-runtime.js order —
//   settings.axCodeBinary > explicit env vars > staged bundled binary > PATH —
//   deliberately WITHOUT the WSL/home-dir fallbacks of the 1294-line original.
// - Spawn uses plain child_process.spawn + stdout parsing of the
//   "ax-code server listening on <url>" line (the web lifecycle's
//   Windows/legacy path, lifecycle.js createManagedAxCodeServerProcessLegacy).
//   The SDK's startHeadlessBackend is not used: it is not a dependency of the
//   electron package, and its built-in one-shot health check + kill-on-failure
//   duplicates the FSM readiness policy (SPEC §4: 10 probes, 5 s→60 s).
// - The runtime port is FIXED per boot (env AX_CODE_PORT, else a reserved free
//   loopback port): the web-server utilityProcess learns the origin once via
//   its env, and its external-mode re-probes target the configured port, so
//   the origin must be stable across FSM restarts. The reserve-then-release
//   TOCTOU window is acceptable on loopback (same pattern as scripts/dev.mjs).
// - The per-boot Basic-auth password (S2.2) is passed to the runtime child env
//   and used for health probes. It is NEVER logged or included in diagnostics.
// - Loopback-only: the runtime is always bound to 127.0.0.1.

const childProcess = require("child_process")
const fs = require("fs")
const net = require("net")
const path = require("path")
const { createSupervisionFsm } = require("./supervision-fsm")
const { getRuntimeAuthPassword } = require("./runtime-auth-password")

const RUNTIME_HOSTNAME = "127.0.0.1"
const READY_LINE_PREFIX = "ax-code server listening on "
// Bounds the driver-side wait for the listening line (the async spawn window).
// Matches the SDK headless launcher's startup timeout; the FSM's boot window
// then covers readiness probing on top.
const LISTENING_LINE_TIMEOUT_MS = 30_000
const VERSION_PROBE_TIMEOUT_MS = 6_000
const CAPTURED_OUTPUT_TAIL_LINES = 20

// SPEC §4 policy: crash budget 5 per 60 s stability window with 500 ms→5 s
// backoff; boot readiness up to 10 probes with 5 s→60 s exponential delays;
// liveness probe every 15 s (5 s timeout), restart after 20 consecutive
// failures. bootTimeoutMs must bound the FULL readiness schedule: 9 delays
// summing 375 s plus up to ~5 s per probe (50 s) = 425 s worst case, rounded
// up to 450 s so readiness exhaustion — not the boot timer — ends a boot.
const RUNTIME_POLICY = {
  maxCrashRestarts: 5,
  stabilityWindowMs: 60_000,
  backoffBaseMs: 500,
  backoffCapMs: 5_000,
  bootTimeoutMs: 450_000,
  stopTermTimeoutMs: 5_000,
  stopKillTimeoutMs: 3_000,
}
const RUNTIME_READINESS = { maxAttempts: 10, baseDelayMs: 5_000, capDelayMs: 60_000, probeTimeoutMs: 5_000 }
const RUNTIME_LIVENESS = { intervalMs: 15_000, timeoutMs: 5_000, maxConsecutiveFailures: 20 }

// Explicit env overrides, highest precedence after settings — same list as the
// web lifecycle's resolveAxCodeCliPath (env-runtime.js).
const BINARY_ENV_KEYS = [
  "AX_CODE_BINARY",
  "AX_CODE_PATH",
  "AX_CODE_DESKTOP_AX_CODE_PATH",
  "AX_CODE_DESKTOP_AX_CODE_BIN",
]

const trim = (value) => (typeof value === "string" ? value.trim() : "")

const defaultIsExecutable = (candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

// On Windows a .cmd/.bat launcher cannot be spawned directly; route it through
// the command interpreter (the bundled staged launcher is ax-code.cmd there).
function resolveSpawnInvocation(binary, args, platform, env) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    const comspec = trim(env.ComSpec) || trim(env.COMSPEC) || "cmd.exe"
    const quoted = [`"${binary}"`, ...args].join(" ")
    return { command: comspec, args: ["/d", "/s", "/c", quoted] }
  }
  return { command: binary, args }
}

function searchPathFor(name, envPath, isExecutable, platform) {
  const dirs = typeof envPath === "string" ? envPath.split(path.delimiter).filter(Boolean) : []
  const names = platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name]
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = path.join(dir, candidate)
      if (isExecutable(full)) return full
    }
  }
  return null
}

// Resolution order (SPEC Slice 3 / env-runtime.js): settings.axCodeBinary >
// explicit env vars > bundled staged binary > ax-code on PATH. Returns
// { binary, source } or null when nothing executable is found.
function resolveRuntimeBinary({ env, settings, isExecutable = defaultIsExecutable, platform = process.platform }) {
  const fromSettings = trim(settings && settings.axCodeBinary)
  if (fromSettings && isExecutable(fromSettings)) {
    return { binary: fromSettings, source: "settings" }
  }
  for (const key of BINARY_ENV_KEYS) {
    const candidate = trim(env[key])
    if (candidate && isExecutable(candidate)) {
      return { binary: candidate, source: "env" }
    }
  }
  const bundled = trim(env.AX_CODE_DESKTOP_BUNDLED_AX_CODE_BINARY)
  if (bundled && isExecutable(bundled)) {
    return { binary: bundled, source: "bundled" }
  }
  const onPath = searchPathFor("ax-code", env.PATH, isExecutable, platform)
  if (onPath) {
    return { binary: onPath, source: "path" }
  }
  return null
}

// Best-effort `<binary> --version` for diagnostics; null on any failure.
function defaultProbeVersion(binary) {
  try {
    const result = childProcess.spawnSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: VERSION_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    if (result.error || result.status !== 0) return null
    const firstLine = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0]
    return firstLine || null
  } catch {
    return null
  }
}

// Reserve a free loopback port by binding :0 and releasing it. The TOCTOU
// window before the runtime rebinds is accepted on loopback (same pattern as
// scripts/dev.mjs) in exchange for a port that is stable across restarts.
function defaultReservePort(hostname) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      const port = address && typeof address === "object" ? address.port : 0
      server.close(() => {
        if (!port) {
          reject(new Error("Failed to allocate a loopback port for the ax-code runtime"))
          return
        }
        resolve(port)
      })
    })
  })
}

function createAxCodeRuntimeSupervision(options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env
  const logger = options.logger || console
  const onOriginChange = typeof options.onOriginChange === "function" ? options.onOriginChange : () => {}
  const settingsReader = typeof options.settingsReader === "function" ? options.settingsReader : () => ({})
  const fsmFactory =
    typeof options.fsmFactory === "function" ? options.fsmFactory : (fsmOptions) => createSupervisionFsm(fsmOptions)
  const getPassword = typeof options.getPassword === "function" ? options.getPassword : getRuntimeAuthPassword
  const spawnImpl = typeof options.spawn === "function" ? options.spawn : (...args) => childProcess.spawn(...args)
  const fetchImpl = typeof options.fetch === "function" ? options.fetch : (...args) => fetch(...args)
  const isExecutable = typeof options.isExecutable === "function" ? options.isExecutable : defaultIsExecutable
  const probeVersion = typeof options.probeVersion === "function" ? options.probeVersion : defaultProbeVersion
  const reservePort = typeof options.reservePort === "function" ? options.reservePort : defaultReservePort
  const platform = typeof options.platform === "string" ? options.platform : process.platform
  const listeningTimeoutMs =
    Number.isInteger(options.listeningTimeoutMs) && options.listeningTimeoutMs > 0
      ? options.listeningTimeoutMs
      : LISTENING_LINE_TIMEOUT_MS

  const policy = { ...RUNTIME_POLICY, ...(options.policy || {}) }
  const readinessConfig = { ...RUNTIME_READINESS, ...(options.readiness || {}) }
  const livenessConfig = { ...RUNTIME_LIVENESS, ...(options.liveness || {}) }

  let fsm = null
  let startPromise = null
  let port = 0
  let fixedOrigin = null
  let currentOrigin = null
  let resolution = null

  const authorizationHeader = () => `Basic ${Buffer.from(`ax-code:${getPassword()}`).toString("base64")}`

  // GET /global/health with the per-boot credential. Mirrors the web
  // lifecycle's probeExternalAxCode: ok status AND body.healthy === true.
  async function checkRuntimeHealth(origin, timeoutMs) {
    try {
      const response = await fetchImpl(`${origin}/global/health`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: authorizationHeader() },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        response.body?.cancel?.()
        return false
      }
      const body = await response.json().catch(() => null)
      return body?.healthy === true
    } catch {
      return false
    }
  }

  // Async spawn driver: spawn the runtime, parse the listening line from
  // stdout, resolve with the handle. Exit/error/timeout before the listening
  // line rejects (the child is killed first so a half-started runtime is
  // never orphaned); after resolution, exits route to wire.exited exactly
  // once per handle.
  function spawnRuntime(wire) {
    return new Promise((resolve, reject) => {
      const args = ["serve", "--hostname", RUNTIME_HOSTNAME, "--port", String(port)]
      const childEnv = { ...env, AX_CODE_SERVER_PASSWORD: getPassword() }
      const invocation = resolveSpawnInvocation(resolution.binary, args, platform, childEnv)
      let child
      try {
        child = spawnImpl(invocation.command, invocation.args, {
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
      } catch (error) {
        reject(error)
        return
      }

      const handle = { child, binary: resolution.binary, port, origin: fixedOrigin }
      const outputTail = []
      let settled = false

      const rememberOutput = (line) => {
        outputTail.push(line)
        if (outputTail.length > CAPTURED_OUTPUT_TAIL_LINES) outputTail.shift()
      }
      const capturedOutputHint = () =>
        outputTail.length > 0 ? ` Recent output:\n${outputTail.join("\n")}` : " No output captured."

      const listeningTimer = setTimeout(() => {
        if (settled) return
        settled = true
        // Kill the half-started runtime before rejecting; the FSM has no
        // handle to terminate yet.
        try {
          child.kill("SIGKILL")
        } catch {
          /* the process may already be gone */
        }
        reject(
          new Error(
            `ax-code runtime did not report its listening address within ${listeningTimeoutMs}ms.${capturedOutputHint()}`,
          ),
        )
      }, listeningTimeoutMs)
      if (typeof listeningTimer.unref === "function") listeningTimer.unref()

      let stdoutBuf = ""
      const onStdout = (chunk) => {
        stdoutBuf += chunk.toString()
        const lines = stdoutBuf.split("\n")
        stdoutBuf = lines.pop() ?? ""
        for (const line of lines) {
          rememberOutput(line)
          logger.log(`[ax-code] ${line}`)
          if (settled || !line.startsWith(READY_LINE_PREFIX)) continue
          const origin = line.slice(READY_LINE_PREFIX.length).trim()
          if (!origin) continue
          settled = true
          clearTimeout(listeningTimer)
          try {
            const parsed = new URL(origin)
            handle.origin = parsed.origin
            const parsedPort = Number.parseInt(parsed.port, 10)
            if (Number.isInteger(parsedPort) && parsedPort > 0) handle.port = parsedPort
          } catch {
            // Keep the fixed origin/port when the line does not parse.
          }
          resolve(handle)
        }
      }
      const onStderr = (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (!line.trim()) continue
          rememberOutput(line)
          logger.error(`[ax-code stderr] ${line}`)
        }
      }
      const onExit = (code, signal) => {
        handle.exit = { code, signal }
        if (!settled) {
          settled = true
          clearTimeout(listeningTimer)
          // Route a pre-listening exit through wire.exited so the FSM records
          // it (lastExit feeds the exhaustion diagnostics) and runs the
          // normal boot-failure path. The rejection only settles this spawn
          // promise so it never dangles; the FSM drops it via its attempt
          // guard because wire.exited already settled the attempt.
          wire.exited(code, signal)
          const reason = signal ? `signal ${signal}` : `code ${code}`
          reject(
            new Error(
              `ax-code runtime exited before reporting its listening address (${reason}).${capturedOutputHint()}`,
            ),
          )
          return
        }
        wire.exited(code, signal)
      }
      const onError = (error) => {
        if (!settled) {
          settled = true
          clearTimeout(listeningTimer)
          reject(error)
        }
      }

      child.stdout?.on("data", onStdout)
      child.stderr?.on("data", onStderr)
      child.on("exit", onExit)
      child.on("error", onError)
    })
  }

  function terminateRuntime(handle) {
    try {
      handle.child.kill("SIGKILL")
    } catch {
      /* the process may already be gone */
    }
  }

  // SIGTERM, escalate to SIGKILL after termTimeoutMs, give up after a further
  // killTimeoutMs. Resolves when the process is gone (or a kill was sent).
  function gracefulStopRuntime(handle, { termTimeoutMs, killTimeoutMs }) {
    return new Promise((resolve) => {
      const child = handle.child
      if (handle.exit || child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      let done = false
      let termTimer = null
      let killTimer = null
      const finish = () => {
        if (done) return
        done = true
        if (termTimer) clearTimeout(termTimer)
        if (killTimer) clearTimeout(killTimer)
        resolve()
      }
      child.once("exit", finish)
      try {
        child.kill("SIGTERM")
      } catch {
        finish()
        return
      }
      termTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {
          /* ignore */
        }
        killTimer = setTimeout(finish, killTimeoutMs)
      }, termTimeoutMs)
    })
  }

  function reportOrigin(origin, context = {}) {
    currentOrigin = origin
    onOriginChange(origin, context)
  }

  function buildExhaustionDiagnostics(event) {
    return {
      error: event.error,
      binary: resolution ? resolution.binary : undefined,
      binarySource: resolution ? resolution.source : undefined,
      version: resolution ? resolution.version || undefined : undefined,
      exitCode: event.exitCode,
      exitSignal: event.exitSignal,
      crashRestarts: event.crashRestarts,
      logHint: "See the Electron main process log for recent [ax-code] stdout/stderr lines.",
    }
  }

  function handleFsmEvent(event) {
    if (event.type === "restart-backoff") {
      logger.error(`[electron] ax-code runtime restart attempt ${event.attempt} failed: ${event.error}`)
      return
    }
    if (event.type === "readiness-probe-failed") {
      logger.warn(
        `[electron] ax-code runtime readiness probe ${event.attempt}/${event.maxAttempts} failed${event.error ? `: ${event.error}` : ""}`,
      )
      return
    }
    if (event.type !== "state-change") return
    if (event.to === "healthy") {
      // The port is fixed for the process lifetime, so the origin is the same
      // after every restart — report it (again) so consumers clear the
      // "restarting" state.
      reportOrigin(fixedOrigin, { exhausted: false })
    } else if (event.to === "degraded" || event.to === "restarting") {
      reportOrigin(null, { exhausted: false })
    } else if (event.to === "exhausted") {
      logger.error(`[electron] ax-code runtime crashed too many times (${event.crashRestarts}), giving up on restart`)
      reportOrigin(null, { exhausted: true, diagnostics: buildExhaustionDiagnostics(event) })
    }
  }

  async function start() {
    if (startPromise) return startPromise
    startPromise = (async () => {
      const settings = settingsReader() || {}
      const resolved = resolveRuntimeBinary({ env, settings, isExecutable, platform })
      if (!resolved) {
        throw new Error(
          "AX Code Desktop could not find the ax-code CLI. Install it and set settings.axCodeBinary to the CLI path, " +
            "or leave the setting empty to use the bundled runtime or a PATH lookup.",
        )
      }
      resolution = { ...resolved, version: probeVersion(resolved.binary) }
      logger.log(
        `[electron] supervising ax-code runtime: ${resolution.binary} (source: ${resolution.source}, version: ${resolution.version || "unknown"})`,
      )

      // Fixed port for the whole supervision lifetime (see module header):
      // env AX_CODE_PORT wins, otherwise reserve a free loopback port.
      const envPort = Number.parseInt(trim(env.AX_CODE_PORT), 10)
      port = Number.isInteger(envPort) && envPort > 0 ? envPort : await reservePort(RUNTIME_HOSTNAME)
      fixedOrigin = `http://${RUNTIME_HOSTNAME}:${port}`

      fsm = fsmFactory({
        label: "ax-code-runtime",
        policy,
        driver: {
          spawn: (wire) => spawnRuntime(wire),
          terminate: terminateRuntime,
          gracefulStop: gracefulStopRuntime,
        },
        readiness: {
          maxAttempts: readinessConfig.maxAttempts,
          baseDelayMs: readinessConfig.baseDelayMs,
          capDelayMs: readinessConfig.capDelayMs,
          probe: (handle) => checkRuntimeHealth(handle.origin, readinessConfig.probeTimeoutMs),
        },
        probe: {
          intervalMs: livenessConfig.intervalMs,
          timeoutMs: livenessConfig.timeoutMs,
          maxConsecutiveFailures: livenessConfig.maxConsecutiveFailures,
          check: (handle) => checkRuntimeHealth(handle.origin, livenessConfig.timeoutMs),
        },
        onEvent: handleFsmEvent,
      })
      await fsm.start()
      return { port, origin: fixedOrigin }
    })()
    try {
      return await startPromise
    } finally {
      // A failed start may be retried by the caller; a successful one is
      // pinned so repeat start() calls share it.
      if (fsm === null || (fsm.state !== "healthy" && fsm.state !== "booting" && fsm.state !== "spawning")) {
        startPromise = null
      }
    }
  }

  async function stop() {
    const current = fsm
    if (!current) return
    await current.stop()
  }

  return {
    start,
    stop,
    get origin() {
      return currentOrigin
    },
    get port() {
      return port
    },
    get state() {
      return fsm ? fsm.state : "idle"
    },
  }
}

module.exports = {
  createAxCodeRuntimeSupervision,
  resolveRuntimeBinary,
  RUNTIME_POLICY,
  RUNTIME_READINESS,
  RUNTIME_LIVENESS,
}
