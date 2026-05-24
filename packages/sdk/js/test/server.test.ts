import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createAxCodeServer } from "../src/server"
import { createAxCodeServer as createAxCodeServerV2 } from "../src/v2/server"

const originalPath = process.env.PATH
const originalPidFile = process.env.AX_CODE_FAKE_PID_FILE
const originalTermFile = process.env.AX_CODE_FAKE_TERM_FILE

afterEach(() => {
  process.env.PATH = originalPath
  setEnv("AX_CODE_FAKE_PID_FILE", originalPidFile)
  setEnv("AX_CODE_FAKE_TERM_FILE", originalTermFile)
})

describe("createAxCodeServer", () => {
  test("kills the spawned server when startup times out", async () => {
    await using fake = await createFakeAxCode()

    await expect(createAxCodeServer({ timeout: 500 })).rejects.toThrow("Timeout waiting for server to start")

    expect(await waitForFile(fake.pidFile)).toMatch(/\d+/)
    await expect(waitForFile(fake.termFile)).resolves.toBe("terminated")
  })

  test("v2 kills the spawned server when startup times out", async () => {
    await using fake = await createFakeAxCode()

    await expect(createAxCodeServerV2({ timeout: 500 })).rejects.toThrow("Timeout waiting for server to start")

    expect(await waitForFile(fake.pidFile)).toMatch(/\d+/)
    await expect(waitForFile(fake.termFile)).resolves.toBe("terminated")
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

async function waitForFile(file: string): Promise<string> {
  const deadline = Date.now() + 1000
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
