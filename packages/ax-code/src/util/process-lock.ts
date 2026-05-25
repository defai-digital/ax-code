export interface ProcessLockBody {
  pid: number
  startedAt: number
  host: string
}

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

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseProcessLockBody<T extends Record<string, unknown> = Record<string, never>>(
  text: string,
): (ProcessLockBody & T) | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isJsonRecord(parsed)) return undefined

    const candidate = parsed as Partial<ProcessLockBody & T>
    if (
      typeof candidate.pid !== "number" ||
      !Number.isFinite(candidate.pid) ||
      typeof candidate.startedAt !== "number" ||
      !Number.isFinite(candidate.startedAt) ||
      typeof candidate.host !== "string"
    ) {
      return undefined
    }

    return candidate as ProcessLockBody & T
  } catch {
    return undefined
  }
}
