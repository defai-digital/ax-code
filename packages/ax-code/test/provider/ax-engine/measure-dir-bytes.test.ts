import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { measureDirBytes } from "../../../src/provider/ax-engine/model-cache"
import { tmpdir } from "../../fixture/fixture"

describe("measureDirBytes", () => {
  test("sums every file concurrently without losing updates", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "sub"))
    const sizes = [10, 20, 30, 40, 50, 60]
    for (const [i, size] of sizes.entries()) {
      const dir = i % 2 ? path.join(tmp.path, "sub") : tmp.path
      await fs.writeFile(path.join(dir, `f${i}.bin`), Buffer.alloc(size))
    }
    expect(await measureDirBytes(tmp.path)).toBe(210)
  })
})
