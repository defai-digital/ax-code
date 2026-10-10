import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Shell } from "../../src/shell/shell"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

function node(script: string) {
  return [process.execPath, "-e", script]
}

describe("util.process", () => {
  test("shellCommand maps win32 to cmd /c and other platforms to sh -c", () => {
    expect(Process.shellCommand("echo hi", "win32")).toEqual(["cmd", "/c", "echo hi"])
    expect(Process.shellCommand("echo hi", "darwin")).toEqual(["sh", "-c", "echo hi"])
    expect(Process.shellCommand("echo hi", "linux")).toEqual(["sh", "-c", "echo hi"])
  })

  test("captures stdout and stderr", async () => {
    const out = await Process.run(node('process.stdout.write("out");process.stderr.write("err")'))
    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toBe("out")
    expect(out.stderr.toString()).toBe("err")
  })

  test("allows pending pipe delivery to reach EOF after the exit event", async () => {
    const child = Process.spawn(node('process.stdout.write("final output")'), { stdout: "pipe" })
    const stdout = child.stdout!
    const chunks: Buffer[] = []
    let ended = false
    stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    stdout.on("end", () => {
      ended = true
    })
    stdout.pause()
    const closed = new Promise<void>((resolve) => stdout.once("close", resolve))
    await child.exited
    await new Promise((resolve) => setTimeout(resolve, 10))
    stdout.resume()
    await closed
    expect(Buffer.concat(chunks).toString()).toBe("final output")
    expect(ended).toBe(true)
  })

  test("returns code when nothrow is enabled", async () => {
    const out = await Process.run(node("process.exit(7)"), { nothrow: true })
    expect(out.code).toBe(7)
  })

  test("throws RunFailedError on non-zero exit", async () => {
    const err = await Process.run(node('process.stderr.write("bad");process.exit(3)')).catch((error) => error)
    expect(err).toBeInstanceOf(Process.RunFailedError)
    if (!(err instanceof Process.RunFailedError)) throw err
    expect(err.code).toBe(3)
    expect(err.stderr.toString()).toBe("bad")
  })

  test("aborts a running process", async () => {
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node("setInterval(() => {}, 1000)"), {
      abort: abort.signal,
      nothrow: true,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("aborts a running process by terminating the full process tree", async () => {
    if (process.platform === "win32") return

    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const originalKillTree = Shell.killTree
    const killTree = vi.spyOn(Shell, "killTree").mockImplementation(async (proc, opts) => {
      return originalKillTree(proc, opts as any)
    })

    try {
      const out = await Process.run(node("setInterval(() => {}, 1000)"), {
        abort: abort.signal,
        nothrow: true,
        timeout: 500,
      })

      expect(killTree).toHaveBeenCalled()
      expect(out.code).not.toBe(0)
      expect(Date.now() - started).toBeLessThan(1200)
    } finally {
      killTree.mockRestore()
    }
  }, 3000)

  test("kills after timeout when process ignores terminate signal", async () => {
    if (process.platform === "win32") return

    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'), {
      abort: abort.signal,
      nothrow: true,
      timeout: 25,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("uses a short force-kill grace after wall-clock timeout", async () => {
    if (process.platform === "win32") return

    const started = Date.now()
    const out = await Process.run(node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'), {
      nothrow: true,
      timeout: 25,
    })

    expect(out.code).toBe(124)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test.skipIf(process.platform === "win32")(
    "timeout reaps descendants when the parent exits on SIGTERM",
    { timeout: 10000, retry: 0 },
    async () => {
      await using tmp = await tmpdir()
      const heartbeat = path.join(tmp.path, "heartbeat")
      const descendantScript = `
const fs = require("node:fs")
process.on("SIGTERM", () => {})
setInterval(() => fs.writeFileSync(process.argv[1], String(Date.now())), 10)
process.send("ready")
`
      const parentScript = `
const { spawn } = require("node:child_process")
const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}, ${JSON.stringify(heartbeat)}], {
  stdio: ["ignore", "ignore", "ignore", "ipc"],
})
child.once("message", () => process.stdout.write(String(child.pid)))
setInterval(() => {}, 1000)
`
      let descendant: number | undefined
      try {
        // Allow both Node processes to register their handlers under full-suite load.
        const out = await Process.run(node(parentScript), { timeout: 5000, nothrow: true })
        descendant = Number(out.stdout.toString())
        expect(Number.isSafeInteger(descendant) && descendant > 0).toBe(true)
        expect(out.code).toBe(124)
        await vi.waitFor(
          async () => {
            const before = await fs.readFile(heartbeat, "utf8")
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(await fs.readFile(heartbeat, "utf8")).toBe(before)
          },
          { timeout: 2000, interval: 100 },
        )
      } finally {
        if (descendant !== undefined && descendant > 0) {
          try {
            process.kill(descendant, "SIGKILL")
          } catch {
            // Independent fixture cleanup also handles a failed regression.
          }
        }
      }
    },
  )

  test.skipIf(process.platform === "win32")("run preserves the requested detached process group", async () => {
    const out = await Process.run(
      node(`
try {
  process.kill(-process.pid, 0)
  process.stdout.write("group leader")
} catch {
  process.stdout.write("shared group")
}
`),
      { detached: true },
    )
    expect(out.stdout.toString()).toBe("group leader")
  })

  test("uses cwd when spawning commands", async () => {
    await using tmp = await tmpdir()
    const out = await Process.run(node("process.stdout.write(process.cwd())"), {
      cwd: tmp.path,
    })
    expect(out.stdout.toString()).toBe(tmp.path)
  })

  test("merges environment overrides", async () => {
    const out = await Process.run(node('process.stdout.write(process.env.AX_CODE_TEST ?? "")'), {
      env: {
        AX_CODE_TEST: "set",
      },
    })
    expect(out.stdout.toString()).toBe("set")
  })

  test("uses shell in run on Windows", async () => {
    if (process.platform !== "win32") return

    const out = await Process.run(["set", "AX_CODE_TEST_SHELL"], {
      shell: true,
      env: {
        AX_CODE_TEST_SHELL: "ok",
      },
    })

    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toContain("AX_CODE_TEST_SHELL=ok")
  })

  test("runs cmd scripts with spaces on Windows without shell", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "echo cmd.cmd")

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

    const proc = Process.spawn([file, "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(await proc.exited).toBe(0)
  })

  test("rejects missing commands without leaking unhandled errors", async () => {
    await using tmp = await tmpdir()
    const cmd = path.join(tmp.path, "missing" + (process.platform === "win32" ? ".cmd" : ""))
    const err = await Process.spawn([cmd], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }).exited.catch((err) => err)

    expect(err).toBeInstanceOf(Error)
    if (!(err instanceof Error)) throw err
    expect(err).toMatchObject({
      code: "ENOENT",
    })
  })
})
