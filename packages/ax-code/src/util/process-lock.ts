import os from "node:os"
import z from "zod"
import { parseJsonResult } from "./json-value"

export interface ProcessLockBody {
  pid: number
  startedAt: number
  host: string
}

const ProcessLockBodySchema = z
  .object({
    // process.kill() accepts negative PIDs as process-group selectors. Lock
    // metadata is untrusted filesystem input, so validate before probing it.
    pid: z.number().int().positive().safe(),
    startedAt: z.number().int().nonnegative().safe(),
    // Keep accepting an empty legacy host. Older releases could write one;
    // treating an active legacy lock as malformed would make some callers
    // reclaim it immediately instead of conservatively treating it as remote.
    host: z.string(),
  })
  .passthrough()

export function currentLockHost(): string {
  // os.hostname(), not process.env.HOSTNAME — HOSTNAME is a shell variable that
  // is not exported into the process env on macOS/Windows (and often Linux),
  // so reading it returned "" for every process and defeated the cross-host
  // lock-steal guard (foreign locks compared equal to the local host).
  return os.hostname()
}

export function isSameProcessLockHost(body: Pick<ProcessLockBody, "host">): boolean {
  return body.host === currentLockHost()
}

export function createProcessLockBody(): ProcessLockBody {
  return {
    pid: process.pid,
    startedAt: Date.now(),
    host: currentLockHost(),
  }
}

export function decodeProcessLockBody<T extends Record<string, unknown> = Record<string, never>>(
  value: unknown,
): (ProcessLockBody & T) | undefined {
  const decoded = ProcessLockBodySchema.safeParse(value)
  return decoded.success ? (decoded.data as ProcessLockBody & T) : undefined
}

export function parseProcessLockBody<T extends Record<string, unknown> = Record<string, never>>(
  text: string,
): (ProcessLockBody & T) | undefined {
  const parsed = parseJsonResult(text)
  if (!parsed.ok) {
    return undefined
  }
  return decodeProcessLockBody<T>(parsed.value)
}
