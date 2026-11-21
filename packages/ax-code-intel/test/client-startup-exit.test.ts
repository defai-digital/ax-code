import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { tmpdir } from "./harness"
import { LSPClient } from "../src/client"
import { captureStderrHead, watchServerStartup } from "../src/client-startup"

// Far below the 45 s handshake timeout these servers used to consume.
const FAIL_FAST_BUDGET_MS = 10_000

function node(script: string) {
  return spawn(process.execPath, ["-e", script], { stdio: "pipe" })
}

async function failure(promise: Promise<unknown>): Promise<Error & { cause?: unknown }> {
  const outcome = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!(outcome instanceof Error)) throw new Error("expected the handshake to fail")
  return outcome
}

test("a server that exits before answering initialize fails the handshake at once", async () => {
  await using tmp = await tmpdir()
  // writeSync: a piped stderr.write is asynchronous on Windows and could be lost at exit.
  const proc = node(
    `require("node:fs").writeSync(2, "error: Unknown binary 'rust-analyzer' in toolchain\\n"); process.exit(3)`,
  )
  captureStderrHead(proc)
  let closes = 0
  const started = performance.now()
  const error = await failure(
    LSPClient.create({ serverID: "fake", server: { process: proc }, root: tmp.path, onClose: () => closes++ }),
  )
  expect(performance.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS)
  expect(LSPClient.InitializeError.isInstance(error)).toBe(true)
  expect(String((error.cause as Error).message)).toContain("exited with code 3 before completing initialize")
  expect(String((error.cause as Error).message)).toContain("Unknown binary 'rust-analyzer'")
  // The rejection is the only report: onClose as well would double the caller's failure count.
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(closes).toBe(0)
  for (const event of ["exit", "close", "error"]) expect(proc.listenerCount(event)).toBe(0)
})

test("a server that had already exited fails the handshake at once", async () => {
  await using tmp = await tmpdir()
  const proc = node("process.exit(0)")
  await new Promise((resolve) => proc.once("close", resolve))
  const started = performance.now()
  const error = await failure(LSPClient.create({ serverID: "fake", server: { process: proc }, root: tmp.path }))
  expect(performance.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS)
  expect(String((error.cause as Error).message)).toContain("exited with code 0 before completing initialize")
})

test("a live server that drops its transport fails the handshake at once", async () => {
  await using tmp = await tmpdir()
  const proc = node(`require("node:fs").closeSync(1); setTimeout(() => {}, 60000)`)
  try {
    const started = performance.now()
    const error = await failure(LSPClient.create({ serverID: "fake", server: { process: proc }, root: tmp.path }))
    expect(performance.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS)
    expect(String((error.cause as Error).message)).toContain("connection closed before completing initialize")
  } finally {
    proc.kill("SIGKILL")
  }
})

// Windows has no signals: the same death is reported as an exit code.
test.skipIf(process.platform === "win32")("a server killed by a signal reports the signal", async () => {
  await using tmp = await tmpdir()
  // Dies only after the request arrived, so the client's write succeeds.
  const proc = node(`process.stdin.once("data", () => process.kill(process.pid, "SIGKILL"))`)
  const error = await failure(LSPClient.create({ serverID: "fake", server: { process: proc }, root: tmp.path }))
  expect(String((error.cause as Error).message)).toContain("terminated by SIGKILL")
})

test("a slow but live server still completes the handshake", async () => {
  await using tmp = await tmpdir()
  const serverPath = fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))
  const proc = spawn(process.execPath, [serverPath], {
    stdio: "pipe",
    env: { ...process.env, FAKE_LSP_INITIALIZE_DELAY_MS: "1200" },
  })
  let closes = 0
  const client = await LSPClient.create({
    serverID: "fake",
    server: { process: proc },
    root: tmp.path,
    onClose: () => closes++,
  })
  try {
    expect(client.closed).toBe(false)
    for (const event of ["exit", "close", "error"]) expect(proc.listenerCount(event)).toBe(0)
    // After the handshake an unexpected close goes to the owner again.
    proc.kill("SIGKILL")
    await expect.poll(() => closes, { timeout: 5_000 }).toBe(1)
  } finally {
    proc.kill("SIGKILL")
  }
})

test("disposing the startup watch never rejects", async () => {
  const proc = node("setTimeout(() => {}, 60000)")
  const watch = watchServerStartup(proc)
  watch.connectionLost(new Error("ignored"))
  watch.dispose()
  proc.kill("SIGKILL")
  await new Promise((resolve) => proc.once("close", resolve))
  const settled = await Promise.race([
    watch.terminated.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 800)),
  ])
  expect(settled).toBe("pending")
})
