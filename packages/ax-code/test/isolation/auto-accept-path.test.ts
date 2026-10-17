import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import path from "node:path"
import fs from "node:fs/promises"
import { Isolation } from "../../src/isolation"
import { tmpdir } from "../fixture/fixture"

describe("Isolation.resolveAutoAcceptPath", () => {
  test("accepts regular files and directories inside the project, and missing children of real directories", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "src"))
    await fs.writeFile(path.join(tmp.path, "src", "a.ts"), "x")
    expect(Isolation.resolveAutoAcceptPath(path.join(tmp.path, "src", "a.ts"), tmp.path)).toBeDefined()
    expect(Isolation.resolveAutoAcceptPath(path.join(tmp.path, "src"), tmp.path)).toBeDefined()
    expect(Isolation.resolveAutoAcceptPath(path.join(tmp.path, "src", "new.ts"), tmp.path)).toBeDefined()
  })

  test("refuses a FIFO because reading it can block or consume another process's stream", async () => {
    await using tmp = await tmpdir()
    const fifo = path.join(tmp.path, "queue")
    try {
      execFileSync("mkfifo", [fifo])
    } catch {
      return // mkfifo unavailable on this platform
    }
    expect(Isolation.resolveAutoAcceptPath(fifo, tmp.path)).toBeUndefined()
  })

  test("refuses a dangling link, a link out of the project and a path outside the project", async () => {
    await using outside = await tmpdir()
    await using tmp = await tmpdir()
    await fs.symlink(path.join(outside.path, "new-file"), path.join(tmp.path, "dangling"))
    await fs.writeFile(path.join(outside.path, "real"), "x")
    await fs.symlink(path.join(outside.path, "real"), path.join(tmp.path, "escape"))
    expect(Isolation.resolveAutoAcceptPath(path.join(tmp.path, "dangling"), tmp.path)).toBeUndefined()
    expect(Isolation.resolveAutoAcceptPath(path.join(tmp.path, "escape"), tmp.path)).toBeUndefined()
    expect(Isolation.resolveAutoAcceptPath(path.join(outside.path, "real"), tmp.path)).toBeUndefined()
  })
})
