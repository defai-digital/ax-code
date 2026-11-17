import type { Argv } from "yargs"
import { DEFAULT_SERVER_PORT } from "@/constants/server"
import { parseIdleTimeoutMs } from "./idle-timeout"

// Keep option registration independent of backend/bootstrap imports so goal
// commands can share it without loading the runtime during CLI registration.
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000

type HeadlessBackendArguments = {
  attach: string | undefined
  password: string | undefined
  autonomous: boolean
  "idle-timeout-ms": number
  "event-log": string | undefined
}

/** Backend options shared by headless-run and goal resume. */
export function headlessBackendOptions<T>(yargs: Argv<T>): Argv<T & HeadlessBackendArguments> {
  return yargs
    .option("attach", {
      describe: `attach to a running ax-code server, e.g. http://localhost:${DEFAULT_SERVER_PORT}`,
      type: "string",
    })
    .option("password", {
      describe: "basic auth password for --attach; defaults to AX_CODE_SERVER_PASSWORD",
      type: "string",
    })
    .option("autonomous", {
      describe: "auto-answer permission/question prompts through the headless effect policy",
      type: "boolean",
      default: true,
    })
    .option("idle-timeout-ms", {
      describe:
        "abort if the headless session emits no events for this long (inactivity timeout — a busy long run keeps resetting it); set 0 to disable",
      type: "number",
      default: DEFAULT_IDLE_TIMEOUT_MS,
      coerce: parseIdleTimeoutMs,
    })
    .option("event-log", {
      describe: "also write raw headless JSONL events to this file",
      type: "string",
    })
}
