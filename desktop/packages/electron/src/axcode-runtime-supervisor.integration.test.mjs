import net from "node:net"
import { createRequire } from "node:module"
import { expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { createAxCodeRuntimeSupervision, resolveRuntimeBinary } = require("./axcode-runtime-supervisor.js")

// Real-spawn integration test (S2.5b): runs the ACTUAL runtime supervision
// against a real ax-code binary — no fake spawn, no fake fetch, no fake
// clock. Binary resolution: explicit env vars (AX_CODE_BINARY, …) first,
// then ax-code on PATH (resolveRuntimeBinary's normal order, minus
// settings). Skipped with a clear message when no executable resolves.
//
// Port hygiene: AX_CODE_PORT is stripped from the inherited env so the
// supervisor reserves a FRESH free loopback port per run; nothing here binds
// a fixed port, so repeated runs and parallel test files never collide.
//
// Credential hygiene: the per-boot password is random per run, passed only
// through the child env and the health-probe header, and never logged (the
// supervisor's unit tests pin that nothing logs it).
const testEnv = { ...process.env }
delete testEnv.AX_CODE_PORT
const resolved = resolveRuntimeBinary({ env: testEnv, settings: {} })

if (!resolved) {
  console.log(
    "[axcode-runtime-supervisor.integration] no ax-code binary found " +
      "(AX_CODE_BINARY unset and ax-code not on PATH) — skipping the real-spawn integration test",
  )
}

const PASSWORD = `integration-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
const AUTHORIZATION = `Basic ${Buffer.from(`ax-code:${PASSWORD}`).toString("base64")}`

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1")
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })

const testWithBinary = resolved ? test : test.skip

testWithBinary(
  "supervises a real ax-code runtime: boot, healthy origin, authenticated health, clean stop",
  async () => {
    const originReports = []
    const supervision = createAxCodeRuntimeSupervision({
      env: testEnv,
      settingsReader: () => ({}),
      logger: console,
      onOriginChange: (origin, context = {}) => originReports.push({ origin, ...context }),
      getPassword: () => PASSWORD,
    })

    try {
      // start() resolves on the healthy transition: spawn → listening line →
      // readiness probes against the real server.
      const { port, origin } = await supervision.start()
      expect(port).toBeGreaterThan(0)
      expect(origin).toBe(`http://127.0.0.1:${port}`)
      expect(supervision.origin).toBe(origin)
      expect(supervision.state).toBe("healthy")
      expect(originReports.at(-1)).toEqual({ origin, exhausted: false })

      // The runtime answers /global/health with the per-boot credential.
      const response = await fetch(`${origin}/global/health`, {
        headers: { Accept: "application/json", Authorization: AUTHORIZATION },
        signal: AbortSignal.timeout(10_000),
      })
      expect(response.ok).toBe(true)
      const body = await response.json()
      expect(body.healthy).toBe(true)
    } finally {
      await supervision.stop()
    }

    expect(supervision.state).toBe("stopped")
    // The runtime process is gone: nothing listens on the reserved port.
    expect(await canConnect(supervision.port)).toBe(false)
  },
  120_000,
)
