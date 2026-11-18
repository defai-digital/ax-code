import { Log } from "../util/log"
import { seedRuntimeFlags } from "../runtime/flags"

let initialization: Promise<void> | undefined

/** Share readiness across SDK callers, and allow a failed startup to be retried. */
export async function ensureSdkRuntime(): Promise<void> {
  const pending = (initialization ??= Promise.resolve().then(async () => {
    await Log.init({ print: false, dev: false, level: "ERROR" })
    seedRuntimeFlags(process.env, { preservePid: true })
  }))
  try {
    await pending
  } catch (error) {
    if (initialization === pending) initialization = undefined
    throw error
  }
}
