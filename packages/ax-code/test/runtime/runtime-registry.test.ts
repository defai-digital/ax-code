import { expect, test } from "vitest"
import fs from "node:fs/promises"
import { constants } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { RuntimeRegistry } from "../../src/runtime/runtime-registry"
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
