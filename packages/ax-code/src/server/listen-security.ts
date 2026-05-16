import { Flag } from "@/flag/flag"

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"])

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname)
}

export function assertAuthenticatedNetworkBind(hostname: string): void {
  if (isLoopbackHostname(hostname)) return
  if (Flag.AX_CODE_SERVER_PASSWORD) return
  throw new Error(
    "AX_CODE_SERVER_PASSWORD is required when binding to a non-loopback address. " +
      "Set the environment variable to secure the server.",
  )
}
