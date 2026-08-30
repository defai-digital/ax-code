"use strict"

// ── Main-supervised ax-code runtime (S2.5) ──────────────────────────────────
// SPEC-2026-08-29-desktop-process-model-collapse §5 S2.5: wires the unified
// supervision FSM (supervision-fsm.js) to the ax-code runtime process so the
// Electron main process can spawn/supervise it directly. S2.5b flipped the
// default: main supervision is ON unless AX_CODE_DESKTOP_SUPERVISE_RUNTIME is
// "0"/"false" (see main.js); only with that escape hatch does the web
// server's own lifecycle keep its pre-S2.5 managed-spawn behavior.
//
// Design notes:
// - Binary resolution mirrors the web lifecycle's env-runtime.js order —
//   settings.axCodeBinary > explicit env vars > staged bundled binary > PATH —
//   deliberately WITHOUT the WSL/home-dir fallbacks of the 1294-line original.
// - Spawn uses plain child_process.spawn + stdout parsing of the
//   "ax-code server listening on <url>" line (the web lifecycle's
//   Windows/legacy path, lifecycle.js createManagedAxCodeServerProcessLegacy).
//   The parse is legacy-tolerant: ANSI escape sequences are stripped first
//   and the URL is extracted from any line carrying the listening marker. A
//   parsed port that differs from the requested fixed port is a BOOT FAILURE
//   (the child is killed): fixedOrigin and the web fork env point at the
//   requested port, so accepting the real port would 503 every runtime
//   request permanently.
//   The SDK's startHeadlessBackend is not used: it is not a dependency of the
//   electron package, and its built-in one-shot health check + kill-on-failure
//   duplicates the FSM readiness policy (SPEC §4: 10 probes, 5 s→60 s).
// - The runtime port is FIXED per boot (env AX_CODE_PORT, else a reserved free
//   loopback port): the web-server utilityProcess learns the origin once via
//   its env, and its external-mode re-probes target the configured port, so
//   the origin must be stable across FSM restarts. The reserve-then-release
//   TOCTOU window is acceptable on loopback (same pattern as scripts/dev.mjs).
// - prepare() (binary resolution + port reservation) is split from start()
//   (FSM boot) so S2.5b parallel boot can learn the fixed port BEFORE the
//   runtime is up: main passes AX_CODE_HOST/AX_CODE_PORT to the web fork env
//   immediately, which keeps the web lifecycle in external mode and is what
//   guarantees the web never managed-spawns a second runtime.
// - Initial-start retry (S2.5c): a failed initial boot (readiness exhausted /
//   spawn exit) is retried up to START_RETRY.maxAttempts total attempts with
//   a 5 s→15 s exponential between them. Documented deviation from the old
//   web bootstrap (2 attempts × 10 readiness retries): each attempt here
//   already contains the full 10-probe readiness schedule (~7.5 min), so 3
//   attempts cover the old worst case. After the final attempt the failure
//   surfaces exactly as before (start() rejects; main shows the terminal
//   dialog). stop() during a retry backoff cancels it.
// - Busy-session restart grace (S2.5c; former web lifecycle policy): the web
//   server posts its active-session count over the utilityProcess channel and
//   main feeds it to setActiveSessionCount(); while the last-known count is
//   > 0 the FSM's wedged-kill (20 consecutive liveness failures) is deferred,
//   capped by a 2-minute stale-busy grace. No signal ever received means 0.
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
// Legacy-tolerant listening-line extraction (old lifecycle.js:284-301): any
// line carrying the listening marker yields its URL via this regex, so log
// prefixes and colorized output still parse. ANSI escapes are stripped first.
const LISTENING_LINE_MARKER = "server listening"
const LISTENING_URL_RE = /on\s+(https?:\/\/[^\s]+)/
// The strip-ansi CSI pattern (color/cursor/control sequences).
const ANSI_ESCAPE_RE = /[\u001b\u009b][[\]\(\)#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g
// Bounds the driver-side wait for the listening line (the async spawn window).
// Matches the SDK headless launcher's startup timeout; the FSM's boot window
// then covers readiness probing on top.
const LISTENING_LINE_TIMEOUT_MS = 30_000
// Best-effort `<binary> --version` runs off prepare()'s critical path (fired
// async), so a wedged binary can only delay diagnostics, never the boot.
const VERSION_PROBE_TIMEOUT_MS = 3_000
const CAPTURED_OUTPUT_TAIL_LINES = 20

// SPEC §4 policy: crash budget 5 per 60 s stability window with 500 ms→5 s
// backoff; boot readiness up to 10 probes with 5 s→60 s exponential delays;
// liveness probe every 15 s (5 s timeout), restart after 20 consecutive
// failures. bootTimeoutMs must bound the FULL boot window: the 30 s
// listening-line wait plus the readiness schedule (9 delays summing 375 s
// plus up to ~5 s per probe ×10 = 50 s → 425 s) = 455 s worst case, rounded
// up to 485 s so readiness exhaustion — not the boot timer — ends a boot.
const RUNTIME_POLICY = {
  maxCrashRestarts: 5,
  stabilityWindowMs: 60_000,
  backoffBaseMs: 500,
  backoffCapMs: 5_000,
  bootTimeoutMs: 485_000,
  stopTermTimeoutMs: 5_000,
  stopKillTimeoutMs: 3_000,
}
const RUNTIME_READINESS = { maxAttempts: 10, baseDelayMs: 5_000, capDelayMs: 60_000, probeTimeoutMs: 5_000 }
const RUNTIME_LIVENESS = { intervalMs: 15_000, timeoutMs: 5_000, maxConsecutiveFailures: 20 }
// Initial-start retry (see module header): 3 total attempts, 5 s→15 s
// exponential between them.
const START_RETRY = { maxAttempts: 3, baseDelayMs: 5_000, capDelayMs: 15_000 }
// Stale-busy grace for the wedged-kill deferral (former web lifecycle
// STALE_BUSY_GRACE_MS): sessions reported busy for this long no longer defer
// the kill.
const BUSY_DEFERRAL_GRACE_MS = 2 * 60 * 1000

// Delay BEFORE initial-start attempt `attemptNumber` (1 = first retry): 5 s,
// then 15 s, capped.
function computeInitialStartRetryDelayMs(attemptNumber, config = START_RETRY) {
  return Math.min(config.baseDelayMs * 3 ** (attemptNumber - 1), config.capDelayMs)
}

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
// The pre-quoted command line requires windowsVerbatimArguments so Node does
// not re-quote it. Used by BOTH the runtime spawn and the version probe.
function resolveSpawnInvocation(binary, args, platform, env) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    const comspec = trim(env.ComSpec) || trim(env.COMSPEC) || "cmd.exe"
    const quoted = [`"${binary}"`, ...args].join(" ")
    return { command: comspec, args: ["/d", "/s", "/c", quoted], windowsVerbatimArguments: true }
  }
  return { command: binary, args, windowsVerbatimArguments: false }
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
// Routed through the same ComSpec wrapping as the runtime spawn so a .cmd
// launcher resolves on Windows too.
function defaultProbeVersion(binary, platform = process.platform, env = process.env) {
  try {
    const invocation = resolveSpawnInvocation(binary, ["--version"], platform, env)
    const result = childProcess.spawnSync(invocation.command, invocation.args, {
      encoding: "utf8",
      timeout: VERSION_PROBE_TIMEOUT_MS,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
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
  const startRetryConfig = { ...START_RETRY, ...(options.startRetry || {}) }
  const busyDeferralGraceMs =
    Number.isInteger(options.busyDeferralGraceMs) && options.busyDeferralGraceMs > 0
      ? options.busyDeferralGraceMs
      : BUSY_DEFERRAL_GRACE_MS

  let fsm = null
  let preparePromise = null
  let startPromise = null
  let restartPromise = null
  let port = 0
  let fixedOrigin = null
  let currentOrigin = null
  let resolution = null
  // Last busy-session count reported by the web server (setActiveSessionCount).
  // No signal ever received means 0 (standalone-ish timing): the wedged kill
  // is then never deferred.
  let lastBusySessionCount = 0
  // The child process ref from the MOMENT of spawn, independent of the FSM
  // handle (which only appears after the async listening-line wait settles).
  // stop() kills whatever ref exists so a quit inside the spawn window cannot
  // orphan a half-started runtime.
  let currentChild = null
  // Set by stop(): cancels an in-flight start() (initial-start retry backoff
  // or the pre-FSM prepare window) so a stopped supervision never spawns.
  let stopRequested = false
  let startBackoffCancel = null

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
  // once per handle. A listening line on a DIFFERENT port than requested is
  // also a boot failure (kill + reject): fixedOrigin and the web fork env
  // point at the requested port, so probing the real port would boot
  // "healthy" while every runtime request 503s.
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
          windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        })
      } catch (error) {
        reject(error)
        return
      }
      // Track the raw child from the moment of spawn (see the declaration):
      // the FSM only learns the handle after the listening line arrives, but
      // stop() must be able to kill the process before that.
      currentChild = child

      const handle = { child, binary: resolution.binary, port, origin: fixedOrigin }
      const outputTail = []
      let settled = false

      const rememberOutput = (line) => {
        outputTail.push(line)
        if (outputTail.length > CAPTURED_OUTPUT_TAIL_LINES) outputTail.shift()
      }
      const capturedOutputHint = () =>
        outputTail.length > 0 ? ` Recent output:\n${outputTail.join("\n")}` : " No output captured."

      // Kill the half-started runtime and reject as a boot failure; used for
      // every pre-listening-line failure where the FSM has no handle yet.
      const failBeforeListening = (error) => {
        if (settled) return
        settled = true
        clearTimeout(listeningTimer)
        try {
          child.kill("SIGKILL")
        } catch {
          /* the process may already be gone */
        }
        reject(error)
      }

      const listeningTimer = setTimeout(() => {
        failBeforeListening(
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
        for (const rawLine of lines) {
          const line = rawLine.replace(ANSI_ESCAPE_RE, "")
          rememberOutput(line)
          logger.log(`[ax-code] ${line}`)
          if (settled || !line.includes(LISTENING_LINE_MARKER)) continue
          const match = line.match(LISTENING_URL_RE)
          let parsed = null
          if (match) {
            try {
              parsed = new URL(match[1])
            } catch {
              parsed = null
            }
          }
          if (!parsed) {
            failBeforeListening(new Error(`Failed to parse the ax-code runtime listening URL from output: ${line}`))
            return
          }
          // Default-port URLs carry an empty port segment; resolve it from the
          // protocol so the comparison below stays exact.
          const parsedPort = parsed.port ? Number.parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80
          if (parsedPort !== port) {
            failBeforeListening(
              new Error(`ax-code runtime listened on port ${parsedPort} but port ${port} was requested`),
            )
            return
          }
          settled = true
          clearTimeout(listeningTimer)
          handle.origin = parsed.origin
          handle.port = parsedPort
          // The FSM owns the process from here (terminate/gracefulStop via
          // the handle); the stop() backstop only covers the pre-handle
          // spawn window.
          if (currentChild === child) currentChild = null
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
        if (currentChild === child) currentChild = null
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

  // Binary resolution + async version probe, shared by prepare() and
  // restart({ reprepare: true }). Throws when nothing executable resolves.
  function resolveBinary() {
    const settings = settingsReader() || {}
    const resolved = resolveRuntimeBinary({ env, settings, isExecutable, platform })
    if (!resolved) {
      throw new Error(
        "AX Code Desktop could not find the ax-code CLI. Install it and set settings.axCodeBinary to the CLI path, " +
          "or leave the setting empty to use the bundled runtime or a PATH lookup.",
      )
    }
    resolution = { ...resolved, version: null }
    logger.log(`[electron] supervising ax-code runtime: ${resolution.binary} (source: ${resolution.source})`)
    // The version probe spawns the binary synchronously (up to
    // VERSION_PROBE_TIMEOUT_MS); fire it off prepare()'s critical path and
    // attach the result to the diagnostics payload when it lands.
    void Promise.resolve()
      .then(() => probeVersion(resolution.binary))
      .then(
        (version) => {
          if (!resolution || resolution.binary !== resolved.binary || !version) return
          resolution.version = version
          logger.log(`[electron] ax-code runtime version: ${version}`)
        },
        () => {},
      )
  }

  // Binary resolution + fixed-port reservation, WITHOUT spawning anything.
  // S2.5b parallel boot awaits this before forking the web server so the web
  // env always carries AX_CODE_HOST/AX_CODE_PORT (the double-spawn invariant),
  // then lets start() run the FSM concurrently with the web boot. Idempotent;
  // a failed prepare may be retried — the result is pinned ONLY after the
  // binary AND the port both resolve (previously a reservePort rejection
  // after a successful resolution stayed pinned forever).
  async function prepare() {
    if (preparePromise) return preparePromise
    let succeeded = false
    const mine = (async () => {
      resolveBinary()

      // Fixed port for the whole supervision lifetime (see module header):
      // env AX_CODE_PORT wins, otherwise reserve a free loopback port.
      const envPort = Number.parseInt(trim(env.AX_CODE_PORT), 10)
      port = Number.isInteger(envPort) && envPort > 0 ? envPort : await reservePort(RUNTIME_HOSTNAME)
      fixedOrigin = `http://${RUNTIME_HOSTNAME}:${port}`
      succeeded = true
      return { port, origin: fixedOrigin }
    })()
    preparePromise = mine
    try {
      return await mine
    } finally {
      if (!succeeded && preparePromise === mine) {
        preparePromise = null
      }
    }
  }

  function createFsm() {
    return fsmFactory({
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
        // Busy-session restart grace (see module header): defer the wedged
        // kill while the web last reported active sessions.
        shouldDeferRestart: () => lastBusySessionCount > 0,
        deferralGraceMs: busyDeferralGraceMs,
      },
      onEvent: handleFsmEvent,
    })
  }

  // Cancellable delay for the initial-start retry backoff. stop() resolves
  // the wait early so a quit never waits out the backoff.
  function waitStartBackoff(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        startBackoffCancel = null
        resolve()
      }, ms)
      if (typeof timer.unref === "function") timer.unref()
      startBackoffCancel = () => {
        clearTimeout(timer)
        startBackoffCancel = null
        resolve()
      }
    })
  }

  async function start() {
    if (startPromise) return startPromise
    const mine = (async () => {
      // A previous stop() must not pin future starts (e.g. restart() above);
      // a stop() landing AFTER this point still cancels via the checks below.
      stopRequested = false
      await prepare()
      // stop() called while prepare() was in flight: never create the FSM or
      // spawn anything.
      if (stopRequested) {
        throw new Error("ax-code runtime start cancelled by stop()")
      }
      if (!fsm) fsm = createFsm()
      // Initial-start retry (see module header): up to maxAttempts total
      // attempts with an exponential backoff between them. The FSM crash
      // budget deliberately does NOT cover the initial start, so the loop
      // lives here. After a failed attempt the FSM is back in `idle`, so
      // fsm.start() is legal again.
      let lastError = null
      for (let attemptNumber = 1; attemptNumber <= startRetryConfig.maxAttempts; attemptNumber += 1) {
        try {
          await fsm.start()
          return { port, origin: fixedOrigin }
        } catch (error) {
          lastError = error
          if (stopRequested || attemptNumber >= startRetryConfig.maxAttempts) break
          const delayMs = computeInitialStartRetryDelayMs(attemptNumber, startRetryConfig)
          logger.warn(
            `[electron] ax-code runtime initial start attempt ${attemptNumber}/${startRetryConfig.maxAttempts} failed: ${lastError.message}; retrying in ${Math.round(delayMs / 1000)}s`,
          )
          await waitStartBackoff(delayMs)
          if (stopRequested) break
        }
      }
      throw lastError || new Error("ax-code runtime failed to start")
    })()
    startPromise = mine
    try {
      return await mine
    } finally {
      // A failed start may be retried by the caller; a successful one is
      // pinned so repeat start() calls share it.
      if (
        startPromise === mine &&
        (fsm === null || (fsm.state !== "healthy" && fsm.state !== "booting" && fsm.state !== "spawning"))
      ) {
        startPromise = null
      }
    }
  }

  async function stop() {
    stopRequested = true
    // Cancel a pending initial-start retry backoff so the quit path never
    // waits out the delay; the start() loop observes stopRequested and exits.
    if (startBackoffCancel) startBackoffCancel()
    const current = fsm
    if (current) await current.stop()
    // Backstop for the spawn window: a child spawned but not yet handed to
    // the FSM (still waiting for its listening line) is not covered by
    // fsm.stop(); kill it here so app.exit() cannot orphan it.
    const orphan = currentChild
    currentChild = null
    if (orphan) {
      try {
        orphan.kill("SIGKILL")
      } catch {
        /* the process may already be gone */
      }
    }
  }

  // Manual restart, e.g. after settings.axCodeBinary changed (the web posts
  // runtime-restart-request and main calls this). With reprepare the binary
  // is re-resolved from current settings/env; the fixed port is deliberately
  // kept — the web fork env and the protocol handler were pinned to it at
  // boot, so re-reserving a new port would strand them.
  async function restart({ reprepare = false } = {}) {
    if (restartPromise) return restartPromise
    const mine = (async () => {
      await stop()
      // The cancelled in-flight start() (if any) rejects on its own and its
      // finally guard only clears its own pin; make sure the fresh start()
      // below never joins the stale promise.
      startPromise = null
      if (reprepare) resolveBinary()
      return start()
    })()
    restartPromise = mine
    try {
      return await mine
    } finally {
      if (restartPromise === mine) restartPromise = null
    }
  }

  // Latest busy-session count reported by the web server; feeds the FSM's
  // busy-session restart grace. Non-negative integers only.
  function setActiveSessionCount(count) {
    if (Number.isInteger(count) && count >= 0) lastBusySessionCount = count
  }

  return {
    prepare,
    start,
    stop,
    restart,
    setActiveSessionCount,
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
  resolveSpawnInvocation,
  computeInitialStartRetryDelayMs,
  RUNTIME_POLICY,
  RUNTIME_READINESS,
  RUNTIME_LIVENESS,
  START_RETRY,
}
