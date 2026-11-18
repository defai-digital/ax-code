import { ChildProcess } from "node:child_process"
import { channel } from "node:diagnostics_channel"

type WorkerExit = { pid: number | undefined; code: number | null; signal: NodeJS.Signals | null }

/** Preserve the exit status Vitest's generic unexpected-worker error omits. */
export function observeWorkerExit(child: ChildProcess, report: (exit: WorkerExit) => void): void {
  let stopped = false
  const onMessage = (message: unknown): void => {
    if (typeof message === "object" && message !== null && "type" in message && message.type === "stopped") {
      stopped = true
    }
  }
  child.on("message", onMessage)
  child.once("exit", (code, signal) => {
    child.off("message", onMessage)
    // Normal shutdown either receives Vitest's acknowledgement or is initiated
    // by the coordinator. Neither should look like a crashed worker.
    if (stopped || child.killed) return
    report({ pid: child.pid, code, signal })
  })
}

export default function setup(): () => void {
  const processes = channel("tracing:child_process.spawn:end")
  const onProcess = (message: unknown): void => {
    if (typeof message !== "object" || message === null || !("process" in message)) return
    const child = message.process
    if (!(child instanceof ChildProcess)) return
    if (!child.spawnargs.some((arg) => arg.replaceAll("\\", "/").endsWith("/vitest/dist/workers/forks.js"))) return
    observeWorkerExit(child, (exit) => {
      process.stderr.write(`Unexpected Vitest worker exit: ${JSON.stringify(exit)}\n`)
    })
  }
  processes.subscribe(onProcess)
  return () => {
    processes.unsubscribe(onProcess)
  }
}
