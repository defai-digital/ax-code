import { afterEach, describe, expect, test } from "vitest"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createAxCodeServer } from "../src/server"
import { createAxCodeServer as createAxCodeServerV2 } from "../src/v2/server"
import { formatHostnameForUrl, resolveServerDefaults } from "../src/internal/server-shared"

const originalPath = process.env.PATH
const originalPidFile = process.env.AX_CODE_FAKE_PID_FILE
const originalTermFile = process.env.AX_CODE_FAKE_TERM_FILE
const originalAuthFile = process.env.AX_CODE_FAKE_AUTH_FILE
const originalArgsFile = process.env.AX_CODE_FAKE_ARGS_FILE

afterEach(() => {
  process.env.PATH = originalPath
  setEnv("AX_CODE_FAKE_PID_FILE", originalPidFile)
  setEnv("AX_CODE_FAKE_TERM_FILE", originalTermFile)
  setEnv("AX_CODE_FAKE_AUTH_FILE", originalAuthFile)
  setEnv("AX_CODE_FAKE_ARGS_FILE", originalArgsFile)
})

describe("createAxCodeServer", () => {
  test("normalizes bracketed IPv6 loopback for bind and URL forms", () => {
    expect(resolveServerDefaults({ hostname: "[::1]" }).hostname).toBe("::1")
    expect(formatHostnameForUrl("::1")).toBe("[::1]")
  })

  test("kills the spawned server when startup times out", async () => {
    await using fake = await createFakeAxCode()

    await expect(createAxCodeServer({ timeout: 500 })).rejects.toThrow("Timeout waiting for server to start")

    expect(await waitForFile(fake.pidFile)).toMatch(/\d+/)
    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("starts with Basic Auth credentials by default", async () => {
    await using fake = await createReadyFakeAxCode()

    const server = await createAxCodeServer({ auth: { username: "app", password: "secret" } })
    try {
      expect(server.url).toBe("http://127.0.0.1:4096")
      expect(server.headers.Authorization).toBe("Basic " + Buffer.from("app:secret").toString("base64"))
      expect(await waitForFile(fake.authFile)).toBe("app:secret\n")
      expect(await waitForFile(fake.argsFile)).toContain("serve --hostname=127.0.0.1 --port=4096")
    } finally {
      server.close()
    }

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("refuses network HTTP binds", async () => {
    await expect(createAxCodeServer({ hostname: "0.0.0.0" })).rejects.toThrow(
      "createAxCodeServer only binds the HTTP API to loopback hostnames",
    )
  })

  test("refuses malformed IPv4 loopback-looking hostnames", async () => {
    for (const hostname of ["127..0.1", "127.0.0.", "127.0.0.1."]) {
      await expect(createAxCodeServer({ hostname })).rejects.toThrow(
        "createAxCodeServer only binds the HTTP API to loopback hostnames",
      )
    }
  })

  test("does not allow the legacy network-bind override", async () => {
    await expect(createAxCodeServer({ hostname: "0.0.0.0", allowNetworkBind: true })).rejects.toThrow("local-only")
  })

  test("v2 kills the spawned server when startup times out", async () => {
    await using fake = await createFakeAxCode()

    await expect(createAxCodeServerV2({ timeout: 500 })).rejects.toThrow("Timeout waiting for server to start")

    expect(await waitForFile(fake.pidFile)).toMatch(/\d+/)
    await expect(waitForFile(fake.termFile)).resolves.toBe("terminated")
  })

  test("v2 starts with Basic Auth credentials by default", async () => {
    await using fake = await createReadyFakeAxCode()

    const server = await createAxCodeServerV2({ auth: { username: "app", password: "secret" } })
    try {
      expect(server.url).toBe("http://127.0.0.1:4096")
      expect(server.headers.Authorization).toBe("Basic " + Buffer.from("app:secret").toString("base64"))
      expect(await waitForFile(fake.authFile)).toBe("app:secret\n")
      expect(await waitForFile(fake.argsFile)).toContain("serve --hostname=127.0.0.1 --port=4096")
    } finally {
      server.close()
    }

    await waitForProcessExit(Number(await waitForFile(fake.pidFile)))
  })

  test("v2 refuses network HTTP binds", async () => {
    await expect(createAxCodeServerV2({ hostname: "0.0.0.0" })).rejects.toThrow(
      "createAxCodeServer only binds the HTTP API to loopback hostnames",
    )
  })

  test("v2 refuses malformed IPv4 loopback-looking hostnames", async () => {
    for (const hostname of ["127..0.1", "127.0.0.", "127.0.0.1."]) {
      await expect(createAxCodeServerV2({ hostname })).rejects.toThrow(
        "createAxCodeServer only binds the HTTP API to loopback hostnames",
      )
    }
  })

  test("v2 does not allow the legacy network-bind override", async () => {
    await expect(createAxCodeServerV2({ hostname: "0.0.0.0", allowNetworkBind: true })).rejects.toThrow("local-only")
  })
})

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

async function createFakeAxCode() {
  const dir = await mkdtemp(path.join(tmpdir(), "ax-code-sdk-server-"))
  const bin = path.join(dir, "ax-code")
  const pidFile = path.join(dir, "pid")
  const termFile = path.join(dir, "terminated")
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$$" > "$AX_CODE_FAKE_PID_FILE"',
      'trap \'printf "terminated" > "$AX_CODE_FAKE_TERM_FILE"; exit 0\' TERM INT',
      "while true; do sleep 1; done",
      "",
    ].join("\n"),
  )
  await chmod(bin, 0o755)

  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`
  process.env.AX_CODE_FAKE_PID_FILE = pidFile
  process.env.AX_CODE_FAKE_TERM_FILE = termFile

  return {
    pidFile,
    termFile,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function createReadyFakeAxCode() {
  const dir = await mkdtemp(path.join(tmpdir(), "ax-code-sdk-server-"))
  const bin = path.join(dir, "ax-code")
  const pidFile = path.join(dir, "pid")
  const termFile = path.join(dir, "terminated")
  const authFile = path.join(dir, "auth")
  const argsFile = path.join(dir, "args")
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$$" > "$AX_CODE_FAKE_PID_FILE"',
      'printf "%s:%s\\n" "$AX_CODE_SERVER_USERNAME" "$AX_CODE_SERVER_PASSWORD" > "$AX_CODE_FAKE_AUTH_FILE"',
      'printf "%s\\n" "$*" > "$AX_CODE_FAKE_ARGS_FILE"',
      'trap \'printf "terminated" > "$AX_CODE_FAKE_TERM_FILE"; exit 0\' TERM INT',
      'printf "ax-code server listening on http://127.0.0.1:4096\\n"',
      "while true; do sleep 1; done",
      "",
    ].join("\n"),
  )
  await chmod(bin, 0o755)

  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`
  process.env.AX_CODE_FAKE_PID_FILE = pidFile
  process.env.AX_CODE_FAKE_TERM_FILE = termFile
  process.env.AX_CODE_FAKE_AUTH_FILE = authFile
  process.env.AX_CODE_FAKE_ARGS_FILE = argsFile

  return {
    pidFile,
    termFile,
    authFile,
    argsFile,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function waitForFile(file: string): Promise<string> {
  const deadline = Date.now() + 2_500
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await readFile(file, "utf8")
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${file}`)
}

async function waitForProcessExit(pid: number) {
  const deadline = Date.now() + 2_500
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for process ${pid} to exit`)
}
