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

export function parseProcessLockBody<T extends Record<string, unknown> = Record<string, never>>(
  text: string,
): (ProcessLockBody & T) | undefined {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object") return undefined

    const candidate = parsed as Partial<ProcessLockBody & T>
    if (
      typeof candidate.pid !== "number" ||
      typeof candidate.startedAt !== "number" ||
      typeof candidate.host !== "string"
    ) {
      return undefined
    }

    return candidate as ProcessLockBody & T
  } catch {
    return undefined
  }
}
