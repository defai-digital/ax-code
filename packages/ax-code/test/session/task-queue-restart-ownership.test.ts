import { spawn } from "node:child_process"
import { once } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ForegroundOwnership } from "../../src/session/foreground-ownership"
import { TaskQueue } from "../../src/session/task-queue"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

test.skipIf(process.platform === "win32").each([false, true])(
  "suspended owners preserve stale steers until SIGKILL (sharded=%s)",
  async (sharded) => {
    const prior = process.env.AX_CODE_SHARD_SESSIONS
    process.env.AX_CODE_SHARD_SESSIONS = sharded ? "1" : "0"
    await using tmp = await tmpdir({ git: true })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const item = await TaskQueue.enqueue({ sessionID: session.id, kind: "followup", title: "Pending correction" })
          await TaskQueue.cancelSteered(item.id, {
            steeredInto: "8b9b2313-8498-47f2-b9ad-f2fcfc4f6085",
            steeredAt: Date.now(),
          })
          const before = await TaskQueue.get(item.id)
          const now = Date.now() + TaskQueue.RESTART_RECOVERY_LIVENESS_MS + 1_000
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              path.join(import.meta.dirname, "../fixture/foreground-owner.ts"),
              Database.Path,
              session.id,
            ],
            { cwd: path.join(import.meta.dirname, "../.."), stdio: ["ignore", "pipe", "pipe"] },
          )
          const exited = once(child, "exit")
          let stderr = ""
          child.stderr.on("data", (chunk) => {
            stderr += chunk.toString()
          })
          try {
            await new Promise<void>((resolve, reject) => {
              let output = ""
              child.stdout.on("data", (chunk) => {
                output += chunk.toString()
                if (output.includes("owned\n")) resolve()
              })
              child.once("error", reject)
              child.once("exit", () => reject(new Error(stderr)))
            })
            const file = ForegroundOwnership.paths(Database.Path, session.id).journal
            const journal = fs.readFileSync(file, "utf8")
            for (const suspended of [false, true]) {
              if (suspended) child.kill("SIGSTOP")
              const recovery = await TaskQueue.recoverInterrupted({ now })
              expect(recovery.requeued).toEqual([])
              expect(recovery.live.map((row) => row.id)).toEqual([item.id])
              expect(await TaskQueue.get(item.id)).toEqual(before)
              expect(fs.readFileSync(file, "utf8")).toBe(journal)
            }
            child.kill("SIGKILL")
            await exited
            const recovery = await TaskQueue.recoverInterrupted({ now })
            expect(recovery.requeued.map((row) => row.id)).toEqual([item.id])
            expect(fs.readFileSync(file, "utf8")).toBe(journal)
            expect((await TaskQueue.recoverInterrupted({ now })).requeued).toEqual([])
          } finally {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL")
              await exited
            }
          }
        },
      })
    } finally {
      if (prior === undefined) delete process.env.AX_CODE_SHARD_SESSIONS
      else process.env.AX_CODE_SHARD_SESSIONS = prior
    }
  },
)
