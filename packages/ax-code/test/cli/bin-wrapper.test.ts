import { describe, expect, test } from "bun:test"
import { chmod, copyFile, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

describe("bin wrapper", () => {
  test("exits non-zero when the wrapped binary is terminated by a signal", async () => {
    if (process.platform === "win32") return

    const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-bin-wrapper-"))
    const target = path.join(dir, "signal-target.sh")
    await writeFile(target, "#!/bin/sh\nkill -TERM $$\n")
    await chmod(target, 0o755)

    const wrapper = path.join(dir, "ax-code")
    await copyFile(path.resolve(import.meta.dir, "../../bin/ax-code"), wrapper)
    await chmod(wrapper, 0o755)

    const result = spawnSync("node", [wrapper], {
      env: {
        ...process.env,
        AX_CODE_BIN_PATH: target,
      },
      encoding: "utf8",
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(143)
  })
})
