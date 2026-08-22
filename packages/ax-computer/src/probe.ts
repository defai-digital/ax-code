import type { ComputerUseProvider } from "./provider"

export interface ProbeReport {
  ok: boolean
  provider: string
  latencyMs: number
  /** number of applications visible to the backend, when the probe succeeded */
  apps?: number
  error?: string
}

const DEFAULT_TIMEOUT_MS = 8_000

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.name === "Error" ? err.message : `${err.name}: ${err.message}`
  return String(err)
}

/**
 * Preflight probe for a computer-use backend: capabilities() plus listApps(),
 * which forces a real MCP round-trip (spawn + handshake + call) for
 * stdio-backed providers. Never throws — returns a structured report, caps the
 * round-trip at `timeoutMs`, and always disposes the provider so a failed or
 * hung probe never leaks a backend process.
 */
export async function probeProvider(
  provider: ComputerUseProvider,
  opts?: { timeoutMs?: number },
): Promise<ProbeReport> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  try {
    const apps = await new Promise<number>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs)
      Promise.resolve(provider.capabilities())
        .then(() => provider.listApps())
        .then((list) => resolve(list.length), reject)
    })
    return { ok: true, provider: provider.name, latencyMs: Date.now() - started, apps }
  } catch (err) {
    return { ok: false, provider: provider.name, latencyMs: Date.now() - started, error: errorMessage(err) }
  } finally {
    if (timer) clearTimeout(timer)
    await provider.dispose().catch(() => {})
  }
}
