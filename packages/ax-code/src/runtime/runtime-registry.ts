import fs from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import z from "zod"
import { Global } from "@/global"
import { FileLock } from "@/util/filelock"
import { parseJsonResult } from "@/util/json-value"
import { ManagedRuntime } from "./managed-runtime"
import { Installation } from "@/installation"
import { Shell } from "@/shell/shell"

export namespace RuntimeRegistry {
  export const Record = ManagedRuntime.Info.extend({
    url: z.string().refine((value) => {
      try {
        const url = new URL(value)
        return (
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1" &&
          !!url.port &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        )
      } catch {
        return false
      }
    }),
    token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  })
  export type Record = z.infer<typeof Record>

  export async function location(directory: string) {
    const canonical = await fs.realpath(directory)
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error("Runtime project must be a directory")
    const root = path.join(Global.Path.state, "runtime")
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    await fs.chmod(root, 0o700)
    const key = createHash("sha256").update(canonical).digest("hex")
    return { directory: canonical, file: path.join(root, `${key}.json`) }
  }

  export async function read(file: string): Promise<Record | undefined> {
    const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!stat) return undefined
    if (!stat.isFile() || stat.size > 16_384 || (process.platform !== "win32" && stat.mode & 0o077)) {
      throw new Error("Unsafe runtime registry record; expected a private regular file")
    }
    const parsed = parseJsonResult(await fs.readFile(file, "utf8"))
    if (!parsed.ok) throw new Error("Invalid runtime registry record")
    return Record.parse(parsed.value)
  }

  export function headers(record: Record) {
    return { "x-ax-code-runtime-token": record.token }
  }

  export async function probe(record: Record) {
    try {
      const response = await fetch(new URL("/global/runtime", record.url), {
        headers: headers(record),
        redirect: "error",
        signal: AbortSignal.timeout(3_000),
      })
      if (!response.ok) return false
      if (!response.body) return false
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 16_384) return false
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }
      const parsed = parseJsonResult(Buffer.concat(chunks).toString("utf8"))
      if (!parsed.ok) return false
      const value = ManagedRuntime.Info.safeParse(parsed.value)
      return (
        value.success &&
        value.data.id === record.id &&
        value.data.pid === record.pid &&
        value.data.directory === record.directory &&
        value.data.host === record.host &&
        value.data.version === record.version &&
        value.data.startedAt === record.startedAt
      )
    } catch {
      return false
    }
  }

  function processExists(record: Record) {
    if (record.host !== os.hostname()) return true
    try {
      process.kill(record.pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH"
    }
  }

  export async function status(directory: string) {
    const where = await location(directory)
    const record = await read(where.file)
    if (!record) return { state: "absent" as const, ...where }
    if (record.directory !== where.directory) throw new Error("Runtime registry project mismatch")
    return { state: (await probe(record)) ? ("running" as const) : ("unavailable" as const), ...where, record }
  }

  export async function start(directory: string, command: { command: string; args: string[] }) {
    const where = await location(directory)
    using lock = await FileLock.acquire(where.file, { timeoutMs: 100_000, staleMs: 120_000 })
    const previous = await read(where.file)
    if (previous) {
      if (previous.directory !== where.directory) throw new Error("Runtime registry project mismatch")
      if (await probe(previous)) {
        if (previous.version !== Installation.VERSION)
          throw new Error("Runtime version differs; stop it before upgrading")
        return previous
      }
      if (processExists(previous))
        throw new Error("Recorded runtime is alive but unavailable; inspect it before retrying")
      await fs.unlink(where.file)
    }
    const log = await fs.open(
      `${where.file}.log`,
      constants.O_CREAT |
        constants.O_APPEND |
        constants.O_WRONLY |
        (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
      0o600,
    )
    await log.chmod(0o600)
    const child = spawn(command.command, command.args, {
      cwd: where.directory,
      env: { ...process.env, AX_CODE_PROJECT: where.directory, AX_CODE_MANAGED_RUNTIME_FILE: where.file },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log.fd, log.fd],
    })
    let spawnError: Error | undefined
    child.on("error", (error) => {
      spawnError = error
    })
    await log.close()
    const deadline = Date.now() + 90_000
    try {
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error("Runtime exited before readiness; inspect its private log")
        const record = await read(where.file)
        if (record && record.pid === child.pid && record.directory === where.directory && (await probe(record))) {
          child.unref()
          return record
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error("Runtime startup timed out; inspect its private log")
    } catch (error) {
      await Shell.killTree(child, { exited: () => child.exitCode !== null || child.signalCode !== null })
      const cleanupDeadline = Date.now() + 3_000
      while (child.pid && child.exitCode === null && child.signalCode === null && Date.now() < cleanupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const published = await read(where.file)
      if (published?.pid === child.pid && published?.directory === where.directory) await fs.unlink(where.file)
      throw error
    }
  }

  export async function stop(directory: string) {
    const where = await location(directory)
    using lock = await FileLock.acquire(where.file, { timeoutMs: 100_000, staleMs: 120_000 })
    const record = await read(where.file)
    if (!record) return false
    if (record.directory !== where.directory) throw new Error("Runtime registry project mismatch")
    if (!(await probe(record))) {
      if (!processExists(record)) {
        await fs.unlink(where.file)
        return false
      }
      throw new Error("Runtime identity could not be verified; no process was stopped")
    }
    const response = await fetch(new URL("/global/runtime/stop", record.url), {
      method: "POST",
      headers: { ...headers(record), "content-type": "application/json" },
      body: JSON.stringify({ id: record.id }),
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined)
    if (response && !response.ok) throw new Error("Runtime rejected shutdown")
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (!processExists(record)) {
        const current = await read(where.file)
        if (current?.id === record.id) await fs.unlink(where.file)
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error("Runtime accepted shutdown but has not exited; inspect status before retrying")
  }
}
