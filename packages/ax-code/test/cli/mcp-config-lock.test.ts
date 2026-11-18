import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { addMcpToConfig, removeMcpFromConfig } from "../../src/config/mcp-file"
import { ConfigPaths } from "../../src/config/paths"
import { FileLock } from "../../src/util/filelock"
import { Filesystem } from "../../src/util/filesystem"
import { Lock } from "../../src/util/lock"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())

test.each(["add", "remove", "invalid"] as const)(
  "MCP %s edits hold both locks through read and write",
  async (operation) => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ax-code.jsonc")
    await Filesystem.write(file, '{"mcp":{"example":{"enabled":false}}}')
    let processHeld = false
    let fileHeld = false
    const processWrite = Lock.write.bind(Lock)
    const fileAcquire = FileLock.acquire.bind(FileLock)
    vi.spyOn(Lock, "write").mockImplementation(async (key) => {
      const lock = await processWrite(key)
      processHeld = true
      return {
        [Symbol.dispose]() {
          processHeld = false
          lock[Symbol.dispose]()
        },
      }
    })
    vi.spyOn(FileLock, "acquire").mockImplementation(async (key, options) => {
      expect(processHeld).toBe(true)
      const lock = await fileAcquire(key, options)
      fileHeld = true
      return {
        [Symbol.dispose]() {
          fileHeld = false
          lock[Symbol.dispose]()
        },
      }
    })
    const readFile = ConfigPaths.readFile.bind(ConfigPaths)
    vi.spyOn(ConfigPaths, "readFile").mockImplementation(async (target) => {
      expect(processHeld && fileHeld).toBe(true)
      return readFile(target)
    })
    const writeFile = Filesystem.write.bind(Filesystem)
    const write = vi.spyOn(Filesystem, "write").mockImplementation(async (...args) => {
      expect(processHeld && fileHeld).toBe(true)
      return writeFile(...args)
    })
    if (operation === "invalid") {
      await expect(addMcpToConfig("example", { type: "local", command: [] }, file)).rejects.toThrow()
      expect(write).not.toHaveBeenCalled()
    } else if (operation === "add") {
      await addMcpToConfig("example", { type: "local", command: ["node"] }, file)
    } else {
      await removeMcpFromConfig("example", file)
    }
    expect(ConfigPaths.readFile).toHaveBeenCalledOnce()
    expect(processHeld || fileHeld).toBe(false)
    using processLock = await processWrite(file)
    using crossProcessLock = await fileAcquire(file, { timeoutMs: 1000 })
    expect(crossProcessLock).toBeDefined()
  },
)
