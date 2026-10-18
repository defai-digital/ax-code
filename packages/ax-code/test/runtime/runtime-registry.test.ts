import { expect, test } from "vitest"
import fs from "node:fs/promises"
import { constants } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { RuntimeRegistry } from "../../src/runtime/runtime-registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test.skipIf(process.platform === "win32")("runtime registry rejects a FIFO without waiting for a writer", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "runtime.json")
  execFileSync("mkfifo", ["-m", "600", file])
  const pending = RuntimeRegistry.read(file).then(
    () => {
      throw new Error("FIFO registry was accepted")
    },
    (error: Error) => error,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Registry blocked on FIFO open")), 1_000)
      }),
    ])
    expect(result.message).toContain("Unsafe runtime registry record")
  } finally {
    clearTimeout(timer)
    // Release a blocked reader even when the regression fails.
    const writer = await fs.open(file, constants.O_RDWR | constants.O_NONBLOCK)
    await pending
    await writer.close()
  }
})

test.skipIf(process.platform === "win32")(
  "stop unlinks a dead record whose host no longer matches this machine",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const where = await RuntimeRegistry.location(tmp.path)
        // A foreign hostname plus a dead PID and a dead loopback URL: the
        // probe fails and the PID is unverifiable across hosts. This used to
        // wedge stop() into an error that never unlinked the record.
        await fs.writeFile(
          where.file,
          JSON.stringify({
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000000",
            pid: 4_000_000,
            directory: where.directory,
            host: "some-other-hostname.local",
            version: "0.0.0-test",
            startedAt: Date.now(),
            url: "http://127.0.0.1:1/",
            token: "a".repeat(43),
          }),
          { mode: 0o600 },
        )

        await expect(RuntimeRegistry.stop(tmp.path)).resolves.toBe(false)
        await expect(fs.stat(where.file)).rejects.toMatchObject({ code: "ENOENT" })
      },
    })
  },
)
