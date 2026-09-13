import z from "zod"
import { randomUUID } from "node:crypto"
import os from "node:os"
import { Installation } from "@/installation"
import { Log } from "@/util/log"

/** Process identity, separate from disk discovery metadata and user credentials. */
export namespace ManagedRuntime {
  export const Info = z.object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    directory: z.string(),
    pid: z.number().int().positive().safe(),
    host: z.string(),
    version: z.string(),
    startedAt: z.number().int().nonnegative(),
  })
  export type Info = z.infer<typeof Info>
  let current: { info: Info; stop: () => Promise<void> } | undefined
  let stopping = false

  export function configure(directory: string, stop: () => Promise<void>) {
    if (current) throw new Error("Managed runtime is already configured")
    current = {
      info: {
        schemaVersion: 1,
        id: randomUUID(),
        directory,
        pid: process.pid,
        host: os.hostname(),
        version: Installation.VERSION,
        startedAt: Date.now(),
      },
      stop,
    }
    return { ...current.info }
  }

  export function info() {
    return current ? { ...current.info } : undefined
  }

  export function requestStop(id: string) {
    if (!current || current.info.id !== id) return false
    if (stopping) return true
    stopping = true
    const stop = current.stop
    setTimeout(
      () =>
        void stop().catch((error) => {
          stopping = false
          Log.Default.error("managed runtime shutdown failed", { error })
        }),
      100,
    )
    return true
  }
}
