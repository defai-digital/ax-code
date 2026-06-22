import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

const spawnMock = vi.fn()
const startHeadlessBackendMock = vi.fn()

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: vi.fn(),
}))

vi.mock("@ax-code/sdk/headless", () => ({
  startHeadlessBackend: startHeadlessBackendMock,
  isLoopbackHostname: (hostname) => {
    if (!hostname) return true
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (normalized === "localhost" || normalized === "::1") return true
    const parts = normalized.split(".")
    if (parts.length !== 4) return false
    const nums = parts.map(Number)
    return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && nums[0] === 127
  },
}))

const { createAxCodeLifecycleRuntime } = await import("./lifecycle.js")

const originalAxCodeBinary = process.env.AX_CODE_BINARY
const originalPath = process.env.PATH

afterEach(() => {
  spawnMock.mockReset()
  startHeadlessBackendMock.mockReset()
  if (typeof originalAxCodeBinary === "string") {
    process.env.AX_CODE_BINARY = originalAxCodeBinary
  } else {
    delete process.env.AX_CODE_BINARY
  }

  if (typeof originalPath === "string") {
    process.env.PATH = originalPath
  } else {
    delete process.env.PATH
  }
})

const createMockChild = () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 12345
  child.kill = vi.fn(() => {
    child.signalCode = "SIGTERM"
    queueMicrotask(() => child.emit("close", null, "SIGTERM"))
    return true
  })
  return child
}

const createLifecycleState = () => ({
  axCodeWorkingDirectory: "/tmp/project",
  axCodeProcess: null,
  axCodePort: null,
  axCodeBaseUrl: null,
  currentRestartPromise: null,
  isRestartingAxCode: false,
  axCodeApiPrefix: "",
  axCodeApiPrefixDetected: false,
  axCodeApiDetectionTimer: null,
  lastAxCodeError: null,
  isAxCodeReady: false,
  axCodeNotReadySince: 0,
  isExternalAxCode: false,
  isShuttingDown: false,
  healthCheckInterval: null,
  expressApp: null,
  useWslForAxCode: false,
  resolvedWslBinary: null,
  resolvedWslAxCodePath: null,
  resolvedWslDistro: null,
})

const createRuntime = (overrides = {}) => {
  const state = overrides.state ?? createLifecycleState()

  return createAxCodeLifecycleRuntime({
    state,
    env: {
      ENV_CONFIGURED_AX_CODE_PORT: 45678,
      ENV_CONFIGURED_AX_CODE_HOST: null,
      ENV_EFFECTIVE_PORT: 3001,
      ENV_CONFIGURED_AX_CODE_HOSTNAME: "127.0.0.1",
      ENV_SKIP_AX_CODE_START: false,
    },
    syncToHmrState: vi.fn(),
    syncFromHmrState: vi.fn(),
    getAxCodeAuthHeaders: () => ({}),
    buildAxCodeUrl: (route) => `http://127.0.0.1:45678${route}`,
    waitForReady: vi.fn(async () => true),
    normalizeApiPrefix: vi.fn(() => ""),
    applyAxCodeBinaryFromSettings: vi.fn(async () => null),
    ensureAxCodeCliEnv: vi.fn(),
    ensureLocalAxCodeServerPassword: vi.fn(async () => "password"),
    buildWslExecArgs: vi.fn((args) => args),
    resolveWslExecutablePath: vi.fn(),
    resolveManagedAxCodeLaunchSpec: vi.fn((binary) => ({ binary, args: [], wrapperType: null })),
    setAxCodePort: vi.fn((port) => {
      state.axCodePort = port
    }),
    setDetectedAxCodeApiPrefix: vi.fn(),
    setupProxy: vi.fn(),
    ensureAxCodeApiPrefix: vi.fn(),
    clearResolvedAxCodeBinary: vi.fn(),
    buildAugmentedPath: vi.fn(() => "/home/user/.local/bin:/usr/local/bin:/usr/bin"),
    buildManagedAxCodePath: vi.fn(() => "/home/user/.local/bin:/usr/local/bin:/usr/bin"),
    getManagedAxCodeShellEnvSnapshot: vi.fn(() => ({
      PATH: "/home/user/.local/bin:/usr/local/bin:/usr/bin",
      SHELL_ONLY: "yes",
      AX_CODE_SERVER_PASSWORD: "shell-password",
    })),
    ...overrides,
  })
}

describe("ax-code lifecycle", () => {
  it("launches managed ax-code through the SDK headless backend with the managed PATH", async () => {
    delete process.env.AX_CODE_BINARY
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
    })

    const runtime = createRuntime()
    const server = await runtime.startAxCode()
    const options = startHeadlessBackendMock.mock.calls[0][0]

    expect(spawnMock).not.toHaveBeenCalled()
    expect(options.directory).toBe("/tmp/project")
    expect(options.hostname).toBe("127.0.0.1")
    expect(options.port).toBe(45678)
    expect(options.binary).toBe("ax-code")
    expect(options.args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", "45678"])
    expect(options.env.PATH).toBe("/home/user/.local/bin:/usr/local/bin:/usr/bin")
    expect(options.env.SHELL_ONLY).toBe("yes")
    expect(options.env.AX_CODE_SERVER_PASSWORD).toBeUndefined()
    expect(options.auth).toEqual({ username: "ax-code", password: "password" })
    expect(options.allowNetworkBind).toBe(false)
    expect(options.signal).toBeInstanceOf(AbortSignal)

    await server.close()
  })

  it("skips waitForReady for the SDK path (health already verified by SDK)", async () => {
    delete process.env.AX_CODE_BINARY
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
    })

    const waitForReady = vi.fn(async () => true)
    const runtime = createRuntime({ waitForReady })
    await runtime.startAxCode()

    expect(waitForReady).not.toHaveBeenCalled()
  })

  it("sets allowNetworkBind when hostname is a non-loopback address", async () => {
    delete process.env.AX_CODE_BINARY
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://0.0.0.0:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
    })

    const runtime = createRuntime({
      env: {
        ENV_CONFIGURED_AX_CODE_PORT: 45678,
        ENV_CONFIGURED_AX_CODE_HOST: null,
        ENV_EFFECTIVE_PORT: 3001,
        ENV_CONFIGURED_AX_CODE_HOSTNAME: "0.0.0.0",
        ENV_SKIP_AX_CODE_START: false,
      },
    })
    const server = await runtime.startAxCode()
    const options = startHeadlessBackendMock.mock.calls[0][0]

    expect(options.allowNetworkBind).toBe(true)
    expect(options.env.AX_CODE_SERVER_PASSWORD).toBeUndefined()

    await server.close()
  })

  it("falls back to buildAugmentedPath when buildManagedAxCodePath is not provided", async () => {
    delete process.env.AX_CODE_BINARY
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: {},
      close: vi.fn(async () => undefined),
    })

    const runtime = createRuntime({
      buildManagedAxCodePath: undefined,
      buildAugmentedPath: vi.fn(() => "/home/user/.cargo/bin:/usr/local/bin"),
    })
    const server = await runtime.startAxCode()
    const options = startHeadlessBackendMock.mock.calls[0][0]

    expect(options.env.PATH).toBe("/home/user/.cargo/bin:/usr/local/bin")

    await server.close()
  })

  it("falls back to process.env.PATH when neither build function is provided", async () => {
    delete process.env.AX_CODE_BINARY
    process.env.PATH = "/usr/bin:/bin"
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: {},
      close: vi.fn(async () => undefined),
    })

    const runtime = createRuntime({
      buildManagedAxCodePath: undefined,
      buildAugmentedPath: undefined,
    })
    const server = await runtime.startAxCode()
    const options = startHeadlessBackendMock.mock.calls[0][0]

    expect(options.env.PATH).toBe("/usr/bin:/bin")

    await server.close()
  })

  it("uses SDK headless backend when the configured binary requires a wrapper", async () => {
    process.env.AX_CODE_BINARY = "/opt/ax-code/cli.js"
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
    })

    const runtime = createRuntime({
      resolveManagedAxCodeLaunchSpec: vi.fn(() => ({
        binary: "bun",
        args: ["/opt/ax-code/cli.js"],
        wrapperType: "bun",
      })),
    })
    const server = await runtime.startAxCode()
    const options = startHeadlessBackendMock.mock.calls[0][0]

    expect(spawnMock).not.toHaveBeenCalled()
    expect(options.binary).toBe("bun")
    expect(options.args).toEqual(["/opt/ax-code/cli.js", "serve", "--hostname", "127.0.0.1", "--port", "45678"])
    expect(options.env.PATH).toBe("/home/user/.local/bin:/usr/local/bin:/usr/bin")

    await server.close()
  })

  it("reports the binary when managed ax-code exits before becoming ready", async () => {
    process.env.AX_CODE_BINARY = "/opt/ax-code/cli.js"
    startHeadlessBackendMock.mockRejectedValue(
      new Error("ax-code backend exited before becoming ready (signal SIGTERM)"),
    )

    const runtime = createRuntime({
      resolveManagedAxCodeLaunchSpec: vi.fn(() => ({
        binary: "bun",
        args: ["/opt/ax-code/cli.js"],
        wrapperType: "bun",
      })),
    })

    await expect(runtime.startAxCode()).rejects.toThrow("ax-code backend exited before becoming ready (signal SIGTERM)")
    expect(spawnMock).not.toHaveBeenCalled()
    expect(startHeadlessBackendMock).toHaveBeenCalledTimes(2)
    expect(startHeadlessBackendMock.mock.calls[0][0].binary).toBe("bun")
    expect(startHeadlessBackendMock.mock.calls[0][0].args).toEqual([
      "/opt/ax-code/cli.js",
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      "45678",
    ])
  })

  it("does not retry startup after shutdown() aborts the in-progress SDK launch", async () => {
    delete process.env.AX_CODE_BINARY
    // Mirror the real SDK pattern: check signal.aborted after addEventListener so an
    // already-aborted signal (shutdown called before the mock runs) is handled correctly.
    startHeadlessBackendMock.mockImplementation(({ signal }) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new Error("startHeadlessBackend aborted"))
        signal?.addEventListener("abort", onAbort, { once: true })
        if (signal?.aborted) {
          onAbort()
        }
      })
    })

    const runtime = createRuntime()

    const startPromise = runtime.startAxCode()
    runtime.shutdown()

    await expect(startPromise).rejects.toThrow("startHeadlessBackend aborted")
    expect(startHeadlessBackendMock).toHaveBeenCalledTimes(1)
  })

  it("SDK handle has null exitCode/signalCode so isManagedAxCodeProcessAlive does not treat it as exited", async () => {
    delete process.env.AX_CODE_BINARY
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
    })

    const runtime = createRuntime()
    const server = await runtime.startAxCode()

    // exitCode and signalCode must be null (not undefined) so hasChildProcessExited()
    // returns false and health check failures go through the consecutive-failures
    // counter instead of triggering an immediate restart.
    expect(server.exitCode).toBe(null)
    expect(server.signalCode).toBe(null)

    await server.close()
  })

  it("does not retry managed startup when the configured ax-code binary is invalid", async () => {
    delete process.env.AX_CODE_BINARY
    const error = new Error("Configured ax-code binary not found: /missing/ax-code")
    error.code = "AX_CODE_BINARY_INVALID"
    const applyAxCodeBinaryFromSettings = vi.fn(async () => {
      throw error
    })

    const runtime = createRuntime({ applyAxCodeBinaryFromSettings })

    await expect(runtime.startAxCode()).rejects.toThrow("Configured ax-code binary not found: /missing/ax-code")
    expect(applyAxCodeBinaryFromSettings).toHaveBeenCalledTimes(1)
    expect(applyAxCodeBinaryFromSettings).toHaveBeenCalledWith({ strict: true })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("marks the SDK handle as exited once its closed promise resolves", async () => {
    delete process.env.AX_CODE_BINARY
    let resolveClosed
    const diagnostics = {
      launchedAt: "2026-06-10T00:00:00.000Z",
      binary: "ax-code",
      args: ["serve"],
      hostname: "127.0.0.1",
      port: 45678,
      readyUrl: "http://127.0.0.1:45678",
      envKeys: ["PATH"],
    }
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
      closed: new Promise((resolve) => {
        resolveClosed = resolve
      }),
      diagnostics,
    })

    const runtime = createRuntime()
    const server = await runtime.startAxCode()

    expect(server.exitCode).toBe(null)
    expect(server.signalCode).toBe(null)

    diagnostics.exit = { code: 1, signal: null, beforeReady: false }
    resolveClosed()
    await new Promise((resolve) => setImmediate(resolve))

    expect(server.exitCode).toBe(1)
    expect(server.signalCode).toBe(null)
  })

  it("surfaces SDK launch diagnostics in lastAxCodeLaunchDiagnostics", async () => {
    delete process.env.AX_CODE_BINARY
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
      closed: new Promise(() => {}),
      diagnostics: {
        launchedAt: "2026-06-10T00:00:00.000Z",
        binary: "/opt/homebrew/bin/ax-code",
        args: ["serve", "--hostname", "127.0.0.1", "--port", "45678"],
        hostname: "127.0.0.1",
        port: 45678,
        readyUrl: "http://127.0.0.1:45678",
        health: { ok: true, status: 200 },
        envKeys: ["PATH", "HOME"],
        capturedOutput: "should not leak into state on success",
      },
    })

    const state = createLifecycleState()
    const runtime = createRuntime({ state })
    const server = await runtime.startAxCode()

    expect(state.lastAxCodeLaunchDiagnostics.sdk).toMatchObject({
      binary: "/opt/homebrew/bin/ax-code",
      readyUrl: "http://127.0.0.1:45678",
      health: { ok: true, status: 200, error: null },
      envKeyCount: 2,
    })
    expect(state.lastAxCodeLaunchDiagnostics.sdk.capturedOutput).toBeUndefined()

    await server.close()
  })

  it("retries managed ax-code startup once after a pre-ready exit", async () => {
    process.env.AX_CODE_BINARY = "/opt/ax-code/cli.js"
    startHeadlessBackendMock.mockRejectedValueOnce(
      new Error("ax-code backend exited before becoming ready (signal SIGTERM)"),
    )
    startHeadlessBackendMock.mockResolvedValueOnce({
      url: "http://127.0.0.1:45678",
      headers: { Authorization: "Basic test" },
      close: vi.fn(async () => undefined),
    })

    const runtime = createRuntime({
      resolveManagedAxCodeLaunchSpec: vi.fn(() => ({
        binary: "bun",
        args: ["/opt/ax-code/cli.js"],
        wrapperType: "bun",
      })),
    })
    const server = await runtime.startAxCode()

    expect(spawnMock).not.toHaveBeenCalled()
    expect(startHeadlessBackendMock).toHaveBeenCalledTimes(2)
    await server.close()
  })
})
