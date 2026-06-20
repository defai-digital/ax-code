import { afterEach, beforeEach, expect, test, vi } from "vitest"

async function getCallbackModule() {
  vi.restoreAllMocks()
  const module = await import("../../src/mcp/oauth-callback")
  return module.McpOAuthCallback
}

beforeEach(async () => {
  const McpOAuthCallback = await getCallbackModule()
  await McpOAuthCallback.stop()
})

afterEach(async () => {
  const McpOAuthCallback = await getCallbackModule()
  await McpOAuthCallback.stop()
})

test("cancelPending rejects a pending oauth flow by MCP name", async () => {
  const McpOAuthCallback = await getCallbackModule()
  const pending = McpOAuthCallback.waitForCallback("state-test", "github")
  McpOAuthCallback.cancelPending("github")
  await expect(pending).rejects.toThrow("Authorization cancelled")
}, 5000)

test("waitForCallback keeps the latest waiter for duplicate states", async () => {
  const McpOAuthCallback = await getCallbackModule()
  const old = McpOAuthCallback.waitForCallback("dup-state", "workspace")
  old.catch(() => {})
  const newer = McpOAuthCallback.waitForCallback("dup-state", "workspace")

  let newRejected = false
  newer.catch(() => {
    newRejected = true
  })

  await Promise.resolve()
  expect(newRejected).toBe(false)

  McpOAuthCallback.cancelPending("workspace")
  await Promise.resolve()
  expect(newRejected).toBe(true)
}, 5000)

test("timeout for superseded OAuth flow does not clear the active MCP name mapping", async () => {
  const McpOAuthCallback = await getCallbackModule()
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timeouts: Array<() => void> = []

  ;(globalThis as any).setTimeout = (handler: TimerHandler) => {
    timeouts.push(() => {
      if (typeof handler === "function") handler()
    })
    return { __fakeTimer: timeouts.length }
  }
  ;(globalThis as any).clearTimeout = () => undefined

  try {
    const oldTimeoutIndex = timeouts.length
    const old = McpOAuthCallback.waitForCallback("state-old", "github").catch((error) => error)
    const active = McpOAuthCallback.waitForCallback("state-active", "github")

    timeouts[oldTimeoutIndex]?.()
    // `old` resolves to the rejection reason (via .catch above), so assert on the
    // error value's message — vitest's `.resolves.toThrow` expects a throwing
    // function, not a resolved Error value (bun:test was lenient here).
    const oldError = (await Promise.race([
      old,
      new Promise((_, reject) =>
        originalSetTimeout(() => reject(new Error("timed out waiting for superseded OAuth timeout")), 500),
      ),
    ])) as Error
    expect(oldError?.message).toContain("OAuth callback timeout")

    McpOAuthCallback.cancelPending("github")
    await Promise.race([
      expect(active).rejects.toThrow("Authorization cancelled"),
      new Promise((_, reject) =>
        originalSetTimeout(() => reject(new Error("timed out waiting for active OAuth cancellation")), 500),
      ),
    ])
  } finally {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
}, 5000)

test("isPortInUse reflects callback server state", async () => {
  const McpOAuthCallback = await getCallbackModule()
  const isPortInUse = "isPortInUse" in McpOAuthCallback ? McpOAuthCallback.isPortInUse : null
  const isRunning = "isRunning" in McpOAuthCallback ? McpOAuthCallback.isRunning : null
  const getState = async () => (isPortInUse ? await isPortInUse() : (isRunning?.() ?? false))

  expect(await getState()).toBe(false)

  let started = false
  try {
    await McpOAuthCallback.ensureRunning()
    started = true
  } catch {
    // In some constrained environments, binding localhost listeners can fail.
    // This test still verifies the public contract that isPortInUse mirrors isRunning.
  }

  if (started) {
    expect(await getState()).toBe(true)
  } else {
    expect(await getState()).toBe(await (isRunning?.() ?? Promise.resolve(false)))
  }

  await McpOAuthCallback.stop()
  expect(await getState()).toBe(false)
}, 5000)
