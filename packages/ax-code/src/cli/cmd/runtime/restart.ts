import { DEFAULT_SERVER_PORT } from "@/server/constants"
import { RuntimeRegistry } from "@/runtime/runtime-registry"

export function validateRuntimeRestartPort(port: unknown): number {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535")
  }
  return port
}

export async function restartRuntimeServer(input: { directory: string; port: unknown }): Promise<boolean> {
  // A managed runtime listens on a random port behind runtime-token auth, so
  // the registry record is the only way to reach it; the raw --port path is
  // the fallback for an unmanaged `ax-code serve` on the default port.
  const status = await RuntimeRegistry.status(input.directory)
  const record = "record" in status ? status.record : undefined
  if (record) {
    // @scan-suppress security_scan - RuntimeRegistry.Record validates an authenticated 127.0.0.1 HTTP URL; redirects are rejected.
    const res = await fetch(new URL("/instance/restart", record.url), {
      method: "POST",
      headers: RuntimeRegistry.headers(record),
      redirect: "error",
    }).catch(() => null)
    return res?.ok === true
  }
  const port = validateRuntimeRestartPort(input.port)
  const res = await fetch(`http://127.0.0.1:${port}/instance/restart`, { method: "POST" }).catch(() => null)
  return res?.ok === true
}
