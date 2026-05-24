import { describe, expect, test } from "bun:test"
import path from "path"
import { FileLock } from "../../src/util/filelock"
import { currentLockHost } from "../../src/util/process-lock"
import { tmpdir } from "../fixture/fixture"

describe("util.filelock", () => {
  test("releases a lock owned by the current process", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"

    const lock = await FileLock.acquire(filepath)
    lock[Symbol.dispose]()

    expect(await Bun.file(lockpath).exists()).toBe(false)
  })

  test("does not delete a lock after ownership changes", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "state.json")
    const lockpath = filepath + ".lock"
    const lock = await FileLock.acquire(filepath)
    const otherOwner = {
      pid: process.pid + 1,
      startedAt: Date.now(),
      host: currentLockHost(),
    }

    await Bun.write(lockpath, JSON.stringify(otherOwner))
    lock[Symbol.dispose]()

    expect(JSON.parse(await Bun.file(lockpath).text())).toEqual(otherOwner)
  })
})
