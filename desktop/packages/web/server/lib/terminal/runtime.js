import crypto from "node:crypto"
import { WebSocketServer } from "ws"
import {
  TERMINAL_INPUT_WS_MAX_PAYLOAD_BYTES,
  TERMINAL_INPUT_WS_PATH,
  TERMINAL_OUTPUT_REPLAY_MAX_BYTES,
  appendTerminalOutputReplayChunk,
  createTerminalOutputReplayBuffer,
  createTerminalInputWsControlFrame,
  isRebindRateLimited,
  listTerminalOutputReplayChunksSince,
  normalizeTerminalInputWsMessageToText,
  parseRequestPathname,
  pruneRebindTimestamps,
  readTerminalInputWsControlFrame,
  resolveTerminalDimensions,
} from "./index.js"

export const observeTerminalShellStartup = (ptyProcess, graceMs) =>
  new Promise((resolve) => {
    let settled = false
    let timer = null
    let earlyOutput = ""
    let dataDisposable = null
    let exitDisposable = null
    const disposeListeners = () => {
      try {
        dataDisposable?.dispose()
      } catch {}
      try {
        exitDisposable?.dispose()
      } catch {}
      dataDisposable = null
      exitDisposable = null
    }
    const finish = (outcome) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // On a healthy start, keep collecting output until the caller wires the
      // permanent onData handler — disposing here left a gap where the prompt
      // (or other early output) could be lost before replay/live delivery.
      if (outcome.crashed) {
        disposeListeners()
        resolve({ ...outcome, earlyOutput })
        return
      }
      resolve({
        ...outcome,
        earlyOutput,
        release: () => {
          // Snapshot any bytes that arrived between resolve and wire, then detach.
          const trailing = earlyOutput
          disposeListeners()
          return trailing
        },
      })
    }

    dataDisposable = ptyProcess.onData((chunk) => {
      earlyOutput += typeof chunk === "string" ? chunk : String(chunk)
    })
    exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => finish({ crashed: true, exitCode, signal }))
    timer = setTimeout(() => finish({ crashed: false }), graceMs)
  })

// A shell can load configuration successfully, then terminate just after the
// initial prompt would normally appear. Keep the candidate under observation
// long enough to fall back before exposing a dead terminal tab to the UI.
export const TERMINAL_SHELL_STARTUP_GRACE_MS = 1_500

export function createTerminalRuntime({
  app,
  server,
  express,
  fs,
  path,
  uiAuthController,
  buildAugmentedPath,
  searchPathFor,
  isExecutable,
  isRequestOriginAllowed,
  rejectWebSocketUpgrade,
  validateCwd,
  TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS,
  TERMINAL_INPUT_WS_REBIND_WINDOW_MS,
  TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW,
}) {
  let ptyProviderPromise = null
  const getPtyProvider = async () => {
    if (ptyProviderPromise) {
      return ptyProviderPromise
    }

    ptyProviderPromise = (async () => {
      try {
        const nodePty = await import("node-pty")
        console.log("Using node-pty for terminal sessions")
        return { spawn: nodePty.spawn, backend: "node-pty" }
      } catch (error) {
        console.error("Failed to load node-pty:", error && error.message ? error.message : error)
        throw new Error("node-pty is not available. Run: npm rebuild node-pty")
      }
    })()

    return ptyProviderPromise
  }

  const resolveExecutableCandidates = (candidates, hasPathSeparator) => {
    const resolved = []
    const seen = new Set()
    for (const candidateRaw of candidates) {
      const candidate = String(candidateRaw || "").trim()
      if (!candidate) continue

      const lookedUp = hasPathSeparator(candidate) ? candidate : searchPathFor(candidate)
      const executable = lookedUp && isExecutable(lookedUp) ? lookedUp : isExecutable(candidate) ? candidate : null
      if (!executable || seen.has(executable)) continue
      seen.add(executable)
      resolved.push(executable)
    }
    return resolved
  }

  const getTerminalShellCandidates = () => {
    if (process.platform === "win32") {
      const windowsCandidates = [
        process.env.AX_CODE_DESKTOP_TERMINAL_SHELL,
        process.env.SHELL,
        process.env.ComSpec,
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        "pwsh.exe",
        "powershell.exe",
        "cmd.exe",
      ]

      return resolveExecutableCandidates(windowsCandidates, (candidate) => candidate.includes("\\") || candidate.includes("/"))
    }

    const unixCandidates = [
      process.env.AX_CODE_DESKTOP_TERMINAL_SHELL,
      process.env.SHELL,
      "/bin/zsh",
      "/bin/bash",
      "/bin/sh",
      "zsh",
      "bash",
      "sh",
    ]

    return resolveExecutableCandidates(unixCandidates, (candidate) => candidate.includes("/"))
  }

  const utf8LocaleFallback = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8"
  const lcCtypeFallback = process.platform === "darwin" ? "UTF-8" : "C.UTF-8"

  // A shell that spawns fine but exits within this window is treated as a
  // startup crash (e.g. a ~/.bashrc that segfaults an old bash) and we fall back
  // to the next candidate. Keep observing even after the first output: a shell
  // can print a banner and exit before it becomes a usable interactive session.
  // Startup output is buffered so the prompt isn't lost.
  const spawnTerminalPtyWithFallback = async (pty, { cols, rows, cwd, env }) => {
    const shellCandidates = getTerminalShellCandidates()
    if (shellCandidates.length === 0) {
      throw new Error("No executable shell found for terminal session")
    }

    let lastError = null
    for (const shell of shellCandidates) {
      let ptyProcess
      try {
        const ptyOptions = {
          name: "xterm-256color",
          cols: cols || 80,
          rows: rows || 24,
          cwd,
          env: {
            ...env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            LANG: env.LANG || process.env.LANG || utf8LocaleFallback,
            LC_CTYPE: env.LC_CTYPE || process.env.LC_CTYPE || lcCtypeFallback,
          },
        }

        if (process.platform === "win32") {
          ptyOptions.useConpty = true
        }

        ptyProcess = pty.spawn(shell, [], ptyOptions)
      } catch (error) {
        lastError = error
        console.warn(`Failed to spawn PTY using shell ${shell}:`, error && error.message ? error.message : error)
        continue
      }

      // pty.spawn returns synchronously even when the shell crashes on startup
      // (the exit arrives asynchronously), so watch briefly and fall back on an
      // immediate exit. Buffer any startup output to seed the replay buffer.
      const outcome = await observeTerminalShellStartup(ptyProcess, TERMINAL_SHELL_STARTUP_GRACE_MS)

      if (outcome.crashed) {
        lastError = new Error(
          `shell ${shell} exited on startup (code ${outcome.exitCode}, signal ${outcome.signal})`,
        )
        console.warn(`Terminal shell ${shell} crashed on startup; trying next candidate: ${lastError.message}`)
        try {
          ptyProcess.kill()
        } catch {}
        continue
      }

      return {
        ptyProcess,
        shell,
        earlyOutput: outcome.earlyOutput,
        // Caller must invoke release() after seeding the replay buffer / wiring
        // permanent listeners so trailing startup output is not dropped.
        releaseStartupObserver: typeof outcome.release === "function" ? outcome.release : () => outcome.earlyOutput,
      }
    }

    const baseMessage = lastError && lastError.message ? lastError.message : "PTY spawn failed"
    throw new Error(
      `Failed to spawn terminal PTY with available shells (${shellCandidates.join(", ")}): ${baseMessage}`,
    )
  }

  const terminalSessions = new Map()
  const terminalWsConnections = new Set()
  const MAX_TERMINAL_SESSIONS = 20
  const TERMINAL_IDLE_TIMEOUT = 30 * 60 * 1000
  const terminalRuntimeName = "node"
  const sanitizeTerminalEnv = (env) => {
    const next = { ...env }
    delete next.BASH_XTRACEFD
    delete next.BASH_ENV
    delete next.ENV
    delete next.AX_CODE_SERVER_PASSWORD
    return next
  }

  const resolveAllowedCwd = async (req, cwd) => {
    if (typeof validateCwd !== "function") {
      return { ok: true, cwd }
    }
    return validateCwd(req, cwd)
  }
  const terminalTransportCapabilities = {
    input: {
      preferred: "ws",
      transports: ["http", "ws"],
      ws: {
        path: TERMINAL_INPUT_WS_PATH,
        v: 2,
        enc: "text+json-bin-control",
      },
    },
    stream: {
      preferred: "ws",
      transports: ["sse", "ws"],
      ws: {
        path: TERMINAL_INPUT_WS_PATH,
        v: 2,
        enc: "text+json-bin-control",
      },
    },
  }

  const killTerminalProcess = (ptyProcess, mode = "term") => {
    if (!ptyProcess) return

    // Best-effort: try killing the process group first so child processes
    // started by shells (e.g. preview dev servers) don't orphan.
    if (process.platform !== "win32") {
      const pid = ptyProcess.pid
      if (typeof pid === "number" && Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(-pid, mode === "kill" ? "SIGKILL" : "SIGTERM")
        } catch {}
      }
    }

    try {
      // node-pty accepts an optional signal string.
      ptyProcess.kill(mode === "kill" ? "SIGKILL" : undefined)
    } catch {}
  }

  const sendTerminalInputWsControl = (socket, payload) => {
    if (!socket || socket.readyState !== 1) {
      return
    }

    try {
      socket.send(createTerminalInputWsControlFrame(payload), { binary: true })
    } catch {}
  }

  const sendTerminalOutputWsData = (socket, sessionId, replayChunk, data = replayChunk?.data) => {
    if (!socket || socket.readyState !== 1 || !replayChunk) {
      return false
    }

    try {
      socket.send(createTerminalInputWsControlFrame({ t: "d", s: sessionId, i: replayChunk.id, d: data }), {
        binary: true,
      })
      return true
    } catch {
      return false
    }
  }

  let terminalInputWsServer = new WebSocketServer({
    noServer: true,
    maxPayload: TERMINAL_INPUT_WS_MAX_PAYLOAD_BYTES,
  })

  terminalInputWsServer.on("connection", (socket) => {
    const connectionState = {
      socket,
      boundSessionId: null,
      invalidFrames: 0,
      rebindTimestamps: [],
      replayCursorBySession: new Map(),
      lastActivityAt: Date.now(),
    }

    terminalWsConnections.add(connectionState)

    sendTerminalInputWsControl(socket, { t: "ok", v: 2 })

    const heartbeatInterval = setInterval(() => {
      if (socket.readyState !== 1) {
        return
      }

      try {
        socket.ping()
      } catch {}
    }, TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS)
    if (typeof heartbeatInterval.unref === "function") heartbeatInterval.unref()

    socket.on("pong", () => {
      connectionState.lastActivityAt = Date.now()
    })

    socket.on("message", (message, isBinary) => {
      connectionState.lastActivityAt = Date.now()

      if (isBinary) {
        const controlMessage = readTerminalInputWsControlFrame(message)
        if (!controlMessage || typeof controlMessage.t !== "string") {
          connectionState.invalidFrames += 1
          sendTerminalInputWsControl(socket, {
            t: "e",
            c: "BAD_FRAME",
            f: connectionState.invalidFrames >= 10,
          })
          if (connectionState.invalidFrames >= 10) {
            socket.close(1008, "protocol violation")
          }
          return
        }

        if (controlMessage.t === "p") {
          sendTerminalInputWsControl(socket, { t: "po", v: 2 })
          return
        }

        if (controlMessage.t !== "b" || typeof controlMessage.s !== "string") {
          connectionState.invalidFrames += 1
          sendTerminalInputWsControl(socket, {
            t: "e",
            c: "BAD_FRAME",
            f: connectionState.invalidFrames >= 10,
          })
          if (connectionState.invalidFrames >= 10) {
            socket.close(1008, "protocol violation")
          }
          return
        }

        const now = Date.now()
        connectionState.rebindTimestamps = pruneRebindTimestamps(
          connectionState.rebindTimestamps,
          now,
          TERMINAL_INPUT_WS_REBIND_WINDOW_MS,
        )

        if (isRebindRateLimited(connectionState.rebindTimestamps, TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW)) {
          sendTerminalInputWsControl(socket, { t: "e", c: "RATE_LIMIT", f: false })
          return
        }

        const nextSessionId = controlMessage.s.trim()
        const targetSession = terminalSessions.get(nextSessionId)
        if (!targetSession) {
          connectionState.boundSessionId = null
          sendTerminalInputWsControl(socket, { t: "e", c: "SESSION_NOT_FOUND", f: false })
          return
        }

        const replaySinceRaw =
          typeof controlMessage.r === "number" && Number.isFinite(controlMessage.r)
            ? Math.max(0, Math.trunc(controlMessage.r))
            : 0
        const rememberedReplayCursor = connectionState.replayCursorBySession.get(nextSessionId) ?? 0
        const replaySince = Math.max(replaySinceRaw, rememberedReplayCursor)

        connectionState.rebindTimestamps.push(now)
        connectionState.boundSessionId = nextSessionId
        sendTerminalInputWsControl(socket, {
          t: "bok",
          v: 2,
          s: nextSessionId,
          runtime: terminalRuntimeName,
          ptyBackend: targetSession.ptyBackend || "unknown",
        })

        const replayChunks = listTerminalOutputReplayChunksSince(targetSession.outputReplayBuffer, replaySince)
        for (const replayChunk of replayChunks) {
          if (sendTerminalOutputWsData(socket, nextSessionId, replayChunk)) {
            connectionState.replayCursorBySession.set(nextSessionId, replayChunk.id)
            continue
          }
          break
        }
        return
      }

      const payload = normalizeTerminalInputWsMessageToText(message)
      if (payload.length === 0) {
        return
      }

      if (!connectionState.boundSessionId) {
        sendTerminalInputWsControl(socket, { t: "e", c: "NOT_BOUND", f: false })
        return
      }

      const session = terminalSessions.get(connectionState.boundSessionId)
      if (!session) {
        connectionState.boundSessionId = null
        sendTerminalInputWsControl(socket, { t: "e", c: "SESSION_NOT_FOUND", f: false })
        return
      }

      try {
        session.ptyProcess.write(payload)
        session.lastActivity = Date.now()
      } catch {
        sendTerminalInputWsControl(socket, { t: "e", c: "WRITE_FAIL", f: false })
      }
    })

    socket.on("close", () => {
      clearInterval(heartbeatInterval)
      connectionState.boundSessionId = null
      terminalWsConnections.delete(connectionState)
    })

    socket.on("error", (error) => {
      // The `ws` library emits "error" before "close" for recoverable
      // transport errors. Logging here for observability; the "close"
      // handler performs actual cleanup.
      console.warn("[terminal-ws] socket error:", error?.message ?? error)
    })
  })

  const upgradeHandler = (req, socket, head) => {
    const pathname = parseRequestPathname(req.url)
    if (pathname !== TERMINAL_INPUT_WS_PATH) {
      return
    }

    const handleUpgrade = async () => {
      try {
        if (uiAuthController?.enabled) {
          // Must be awaited: this call performs async token verification.
          const sessionToken = await uiAuthController?.ensureSessionToken?.(req, null)
          if (!sessionToken) {
            rejectWebSocketUpgrade(socket, 401, "UI authentication required")
            return
          }

          const originAllowed = await isRequestOriginAllowed(req)
          if (!originAllowed) {
            rejectWebSocketUpgrade(socket, 403, "Invalid origin")
            return
          }
        }

        if (!terminalInputWsServer) {
          rejectWebSocketUpgrade(socket, 500, "Terminal WebSocket unavailable")
          return
        }

        terminalInputWsServer.handleUpgrade(req, socket, head, (ws) => {
          terminalInputWsServer.emit("connection", ws, req)
        })
      } catch {
        rejectWebSocketUpgrade(socket, 500, "Upgrade failed")
      }
    }

    void handleUpgrade()
  }

  server.on("upgrade", upgradeHandler)

  const wireTerminalSession = (sessionId, session) => {
    session.ptyProcess.onData((data) => {
      session.lastActivity = Date.now()
      const replayChunk = appendTerminalOutputReplayChunk(
        session.outputReplayBuffer,
        data,
        TERMINAL_OUTPUT_REPLAY_MAX_BYTES,
      )

      for (const wsConnection of terminalWsConnections) {
        if (wsConnection.boundSessionId !== sessionId) {
          continue
        }

        if (!wsConnection.socket || wsConnection.socket.readyState !== 1) {
          continue
        }

        if (sendTerminalOutputWsData(wsConnection.socket, sessionId, replayChunk, data)) {
          wsConnection.replayCursorBySession.set(sessionId, replayChunk.id)
        }
      }
    })

    session.ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`Terminal session ${sessionId} exited with code ${exitCode}, signal ${signal}`)
      for (const wsConnection of terminalWsConnections) {
        if (wsConnection.boundSessionId !== sessionId) {
          continue
        }

        wsConnection.boundSessionId = null
        wsConnection.replayCursorBySession.delete(sessionId)
        sendTerminalInputWsControl(wsConnection.socket, {
          t: "x",
          v: 2,
          s: sessionId,
          exitCode,
          signal,
        })
      }

      terminalSessions.delete(sessionId)
    })
  }

  const idleSweepInterval = setInterval(
    () => {
      const now = Date.now()
      for (const [sessionId, session] of terminalSessions.entries()) {
        if (now - session.lastActivity > TERMINAL_IDLE_TIMEOUT) {
          console.log(`Cleaning up idle terminal session: ${sessionId}`)
          try {
            killTerminalProcess(session.ptyProcess, "term")
          } catch (error) {}
          terminalSessions.delete(sessionId)
        }
      }
    },
    5 * 60 * 1000,
  )
  if (typeof idleSweepInterval.unref === "function") idleSweepInterval.unref()

  app.post("/api/terminal/create", async (req, res) => {
    try {
      if (terminalSessions.size >= MAX_TERMINAL_SESSIONS) {
        return res.status(429).json({ error: "Maximum terminal sessions reached" })
      }

      let { cwd } = req.body
      if (!cwd) {
        return res.status(400).json({ error: "cwd is required" })
      }

      const terminalSize = resolveTerminalDimensions(req.body)
      if (!terminalSize.ok) {
        return res.status(400).json({ error: terminalSize.error })
      }

      try {
        const allowed = await resolveAllowedCwd(req, cwd)
        if (!allowed.ok) {
          return res.status(403).json({ error: allowed.error || "Terminal cwd is not approved" })
        }
        cwd = allowed.cwd || cwd
        const stats = await fs.promises.stat(cwd)
        if (!stats.isDirectory()) {
          return res.status(400).json({ error: "Invalid working directory" })
        }
      } catch {
        return res.status(400).json({ error: "Invalid working directory" })
      }

      const sessionId = crypto.randomBytes(24).toString("hex")

      const envPath = buildAugmentedPath()
      const resolvedEnv = sanitizeTerminalEnv({ ...process.env, PATH: envPath })

      const pty = await getPtyProvider()
      const { ptyProcess, shell, releaseStartupObserver } = await spawnTerminalPtyWithFallback(pty, {
        cols: terminalSize.cols,
        rows: terminalSize.rows,
        cwd,
        env: resolvedEnv,
      })

      const session = {
        ptyProcess,
        ptyBackend: pty.backend,
        cwd,
        lastActivity: Date.now(),
        clients: new Set(),
        outputReplayBuffer: createTerminalOutputReplayBuffer(),
      }

      terminalSessions.set(sessionId, session)
      // Capture every byte observed during startup (including any that arrived
      // after the grace window resolved) before installing the live handlers.
      const startupOutput = releaseStartupObserver()
      if (startupOutput) {
        appendTerminalOutputReplayChunk(session.outputReplayBuffer, startupOutput, TERMINAL_OUTPUT_REPLAY_MAX_BYTES)
      }
      wireTerminalSession(sessionId, session)

      console.log(`Created terminal session: ${sessionId} in ${cwd} using shell ${shell}`)
      res.json({
        sessionId,
        cols: terminalSize.cols,
        rows: terminalSize.rows,
        capabilities: terminalTransportCapabilities,
      })
    } catch (error) {
      console.error("Failed to create terminal session:", error)
      res.status(500).json({ error: error.message || "Failed to create terminal session" })
    }
  })

  app.get("/api/terminal/:sessionId/stream", (req, res) => {
    const { sessionId } = req.params
    const session = terminalSessions.get(sessionId)

    if (!session) {
      return res.status(404).json({ error: "Terminal session not found" })
    }

    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")

    const clientId = crypto.randomBytes(12).toString("hex")
    session.clients.add(clientId)
    session.lastActivity = Date.now()

    const ptyBackend = session.ptyBackend || "unknown"
    res.write(`data: ${JSON.stringify({ type: "connected", runtime: terminalRuntimeName, ptyBackend })}\n\n`)

    const heartbeatInterval = setInterval(() => {
      try {
        res.write(": heartbeat\n\n")
      } catch (error) {
        console.error(`Heartbeat failed for client ${clientId}:`, error)
        // Fully tear down, not just the interval: a write failure here may not
        // be accompanied by a req 'close' event, so clearing only the interval
        // would leak the pty onData/onExit disposables and the client entry.
        // cleanup() is idempotent and also clears this interval.
        cleanup()
      }
    }, 15000)
    if (typeof heartbeatInterval.unref === "function") heartbeatInterval.unref()

    let cleanedUp = false
    let paused = false
    let dataDisposable = null
    let exitDisposable = null
    const cleanup = () => {
      if (cleanedUp) {
        return
      }

      cleanedUp = true
      clearInterval(heartbeatInterval)
      session.clients.delete(clientId)

      // If this client paused the shared pty for backpressure and then
      // disconnected before the 'drain' fired, the resume would never run and
      // the pty would stay paused forever — freezing output for every other
      // client and the replay buffer. Resume it as part of teardown.
      if (paused && session.ptyProcess && typeof session.ptyProcess.resume === "function") {
        try {
          session.ptyProcess.resume()
        } catch (error) {
          console.error(`Failed to resume pty on cleanup for client ${clientId}:`, error)
        }
        paused = false
      }

      if (dataDisposable && typeof dataDisposable.dispose === "function") {
        dataDisposable.dispose()
      }
      if (exitDisposable && typeof exitDisposable.dispose === "function") {
        exitDisposable.dispose()
      }

      try {
        res.end()
      } catch (error) {}

      console.log(`Client ${clientId} disconnected from terminal session ${sessionId}`)
    }

    const dataHandler = (data) => {
      try {
        session.lastActivity = Date.now()
        const ok = res.write(`data: ${JSON.stringify({ type: "data", data })}\n\n`)
        if (!ok && session.ptyProcess && typeof session.ptyProcess.pause === "function") {
          session.ptyProcess.pause()
          paused = true
          res.once("drain", () => {
            paused = false
            if (session.ptyProcess && typeof session.ptyProcess.resume === "function") {
              session.ptyProcess.resume()
            }
          })
        }
      } catch (error) {
        console.error(`Error sending data to client ${clientId}:`, error)
        cleanup()
      }
    }

    const exitHandler = ({ exitCode, signal }) => {
      try {
        res.write(`data: ${JSON.stringify({ type: "exit", exitCode, signal })}\n\n`)
        res.end()
      } catch (error) {}
      cleanup()
    }

    dataDisposable = session.ptyProcess.onData(dataHandler)
    if (cleanedUp && dataDisposable && typeof dataDisposable.dispose === "function") {
      dataDisposable.dispose()
    }

    exitDisposable = session.ptyProcess.onExit(exitHandler)
    if (cleanedUp && exitDisposable && typeof exitDisposable.dispose === "function") {
      exitDisposable.dispose()
    }

    req.on("close", cleanup)
    req.on("error", cleanup)

    console.log(
      `Terminal connected: session=${sessionId} client=${clientId} runtime=${terminalRuntimeName} pty=${ptyBackend}`,
    )
  })

  app.post("/api/terminal/:sessionId/input", express.text({ type: "*/*" }), (req, res) => {
    const { sessionId } = req.params
    const session = terminalSessions.get(sessionId)

    if (!session) {
      return res.status(404).json({ error: "Terminal session not found" })
    }

    const data = typeof req.body === "string" ? req.body : ""

    try {
      session.ptyProcess.write(data)
      session.lastActivity = Date.now()
      res.json({ success: true })
    } catch (error) {
      console.error("Failed to write to terminal:", error)
      res.status(500).json({ error: error.message || "Failed to write to terminal" })
    }
  })

  app.post("/api/terminal/:sessionId/resize", (req, res) => {
    const { sessionId } = req.params
    const session = terminalSessions.get(sessionId)

    if (!session) {
      return res.status(404).json({ error: "Terminal session not found" })
    }

    const terminalSize = resolveTerminalDimensions(req.body, { requireBoth: true })
    if (!terminalSize.ok) {
      return res.status(400).json({ error: terminalSize.error })
    }

    try {
      session.ptyProcess.resize(terminalSize.cols, terminalSize.rows)
      session.lastActivity = Date.now()
      res.json({ success: true, cols: terminalSize.cols, rows: terminalSize.rows })
    } catch (error) {
      console.error("Failed to resize terminal:", error)
      res.status(500).json({ error: error.message || "Failed to resize terminal" })
    }
  })

  app.delete("/api/terminal/:sessionId", (req, res) => {
    const { sessionId } = req.params
    const session = terminalSessions.get(sessionId)

    if (!session) {
      return res.status(404).json({ error: "Terminal session not found" })
    }

    try {
      killTerminalProcess(session.ptyProcess, "term")
      terminalSessions.delete(sessionId)
      console.log(`Closed terminal session: ${sessionId}`)
      res.json({ success: true })
    } catch (error) {
      console.error("Failed to close terminal:", error)
      res.status(500).json({ error: error.message || "Failed to close terminal" })
    }
  })

  app.post("/api/terminal/:sessionId/restart", async (req, res) => {
    const { sessionId } = req.params
    let { cwd } = req.body

    if (!cwd) {
      return res.status(400).json({ error: "cwd is required" })
    }

    const terminalSize = resolveTerminalDimensions(req.body)
    if (!terminalSize.ok) {
      return res.status(400).json({ error: terminalSize.error })
    }

    const existingSession = terminalSessions.get(sessionId)
    if (existingSession) {
      try {
        killTerminalProcess(existingSession.ptyProcess, "term")
      } catch (error) {}
      terminalSessions.delete(sessionId)
    }

    try {
      try {
        const allowed = await resolveAllowedCwd(req, cwd)
        if (!allowed.ok) {
          return res.status(403).json({ error: allowed.error || "Terminal cwd is not approved" })
        }
        cwd = allowed.cwd || cwd
        const stats = await fs.promises.stat(cwd)
        if (!stats.isDirectory()) {
          return res.status(400).json({ error: "Invalid working directory: not a directory" })
        }
      } catch (error) {
        return res.status(400).json({ error: "Invalid working directory: not accessible" })
      }

      const newSessionId = crypto.randomBytes(24).toString("hex")

      const envPath = buildAugmentedPath()
      const resolvedEnv = sanitizeTerminalEnv({ ...process.env, PATH: envPath })

      const pty = await getPtyProvider()
      const { ptyProcess, shell, releaseStartupObserver } = await spawnTerminalPtyWithFallback(pty, {
        cols: terminalSize.cols,
        rows: terminalSize.rows,
        cwd,
        env: resolvedEnv,
      })

      const session = {
        ptyProcess,
        ptyBackend: pty.backend,
        cwd,
        lastActivity: Date.now(),
        clients: new Set(),
        outputReplayBuffer: createTerminalOutputReplayBuffer(),
      }

      terminalSessions.set(newSessionId, session)
      const startupOutput = releaseStartupObserver()
      if (startupOutput) {
        appendTerminalOutputReplayChunk(session.outputReplayBuffer, startupOutput, TERMINAL_OUTPUT_REPLAY_MAX_BYTES)
      }
      wireTerminalSession(newSessionId, session)

      console.log(`Restarted terminal session: ${sessionId} -> ${newSessionId} in ${cwd} using shell ${shell}`)
      res.json({
        sessionId: newSessionId,
        cols: terminalSize.cols,
        rows: terminalSize.rows,
        capabilities: terminalTransportCapabilities,
      })
    } catch (error) {
      console.error("Failed to restart terminal session:", error)
      res.status(500).json({ error: error.message || "Failed to restart terminal session" })
    }
  })

  app.post("/api/terminal/force-kill", (req, res) => {
    const { sessionId, cwd } = req.body
    let killedCount = 0

    if (sessionId) {
      const session = terminalSessions.get(sessionId)
      if (session) {
        try {
          killTerminalProcess(session.ptyProcess, "kill")
        } catch (error) {}
        terminalSessions.delete(sessionId)
        killedCount++
      }
    } else if (cwd) {
      for (const [id, session] of terminalSessions) {
        if (session.cwd === cwd) {
          try {
            killTerminalProcess(session.ptyProcess, "kill")
          } catch (error) {}
          terminalSessions.delete(id)
          killedCount++
        }
      }
    } else {
      for (const [id, session] of terminalSessions) {
        try {
          killTerminalProcess(session.ptyProcess, "kill")
        } catch (error) {}
        terminalSessions.delete(id)
        killedCount++
      }
    }

    console.log(`Force killed ${killedCount} terminal session(s)`)
    res.json({ success: true, killedCount })
  })

  const shutdown = async () => {
    server.off("upgrade", upgradeHandler)

    if (idleSweepInterval) {
      clearInterval(idleSweepInterval)
    }

    for (const [sessionId, session] of terminalSessions.entries()) {
      try {
        killTerminalProcess(session.ptyProcess, "kill")
      } catch {}
      terminalSessions.delete(sessionId)
    }

    if (!terminalInputWsServer) {
      return
    }

    try {
      for (const client of terminalInputWsServer.clients) {
        try {
          client.terminate()
        } catch {}
      }

      await new Promise((resolve) => {
        terminalInputWsServer.close(() => resolve())
      })
    } catch {
    } finally {
      terminalInputWsServer = null
    }
  }

  return { shutdown }
}
