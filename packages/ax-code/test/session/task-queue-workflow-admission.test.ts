import { spawn } from "node:child_process"
import { once } from "node:events"
import path from "node:path"
import { createInterface } from "node:readline"
import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { TaskQueue } from "../../src/session/task-queue"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

test.each(["phase capacity", "run pacing"] as const)(
  "enforces %s across two executors sharing a database",
  async (policy) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tasks: TaskQueue.Info[] = []
        for (const childID of ["wfc_first", "wfc_second"]) {
          const session = await Session.create({})
          tasks.push(
            await TaskQueue.enqueue({
              sessionID: session.id,
              kind: "subagent",
              title: childID,
              payload: {
                workflow: {
                  runID: "wfr_admission",
                  phaseID: policy === "phase capacity" ? "wfp_admission" : `wfp_${childID}`,
                  childID,
                },
                ...(policy === "phase capacity"
                  ? { maxParallel: 1 }
                  : { pacing: { maxRequestsPerMinute: 1, maxTokensPerMinute: 100_000 } }),
                body: {
                  noReply: true,
                  model: { providerID: "openai", modelID: "gpt-5.4" },
                  parts: [{ type: "text", text: "Offline queue claim fixture." }],
                },
              },
            }),
          )
        }
        const processes = tasks.map((task) => {
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              "--import",
              "./script/register-node.ts",
              "--import",
              "../../script/solid-loader.mjs",
              "--conditions=node",
              path.join(import.meta.dirname, "../fixture/workflow-claim-worker.ts"),
              tmp.path,
              task.id,
            ],
            {
              cwd: path.join(import.meta.dirname, "../.."),
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, AX_CODE_DB: Database.Path },
            },
          )
          const exit = once(child, "exit")
          let stderr = ""
          child.stderr.on("data", (chunk) => {
            stderr += chunk
          })
          const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
          return {
            child,
            exit,
            async nextLine() {
              const line = await lines.next()
              if (line.done) throw new Error(`Workflow claim worker exited: ${stderr}`)
              return line.value
            },
          }
        })
        try {
          // Both executors reach the database claim before either may proceed.
          expect(await Promise.all(processes.map((worker) => worker.nextLine()))).toEqual(["ready", "ready"])
          for (const { child } of processes) child.stdin.end("claim\n")
          const statuses = await Promise.all(processes.map((worker) => worker.nextLine()))
          expect(statuses.sort()).toEqual(["status queued", "status running"])
        } finally {
          for (const { child } of processes) child.kill()
          await Promise.allSettled(processes.map((worker) => worker.exit))
        }
      },
    })
  },
  30_000,
)
