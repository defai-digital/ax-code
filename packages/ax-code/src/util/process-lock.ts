import z from "zod"

export interface ProcessLockBody {
  pid: number
  startedAt: number
  host: string
}

const ProcessLockBodySchema = z
  .object({
    pid: z.number().finite(),
    startedAt: z.number().finite(),
    host: z.string(),
  })
  .passthrough()

export function currentLockHost(): string {
  return process.env.HOSTNAME ?? ""
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
  try {
    const parsed: unknown = JSON.parse(text)
    return decodeProcessLockBody<T>(parsed)
  } catch {
    return undefined
  }
}
