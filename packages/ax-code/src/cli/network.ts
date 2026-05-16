import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service (default: ax-code.local)",
    default: "ax-code.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await Config.global()
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const mdnsDomainExplicitlySet = process.argv.includes("--mdns-domain")
  const corsExplicitlySet = process.argv.includes("--cors")

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, mdnsDomain, cors }
}

const LOCALHOST_ADDRESSES = new Set(["127.0.0.1", "localhost", "::1"])

export function isLocalhostOnly(hostname: string) {
  return LOCALHOST_ADDRESSES.has(hostname)
}

export function requireAuthForNetwork(hostname: string) {
  if (isLocalhostOnly(hostname)) return
  if (Flag.AX_CODE_SERVER_PASSWORD) return
  console.error(
    "Error: AX_CODE_SERVER_PASSWORD is required when binding to a network address.\n" +
      `  hostname: ${hostname}\n\n` +
      "Set a password to secure the server:\n" +
      "  export AX_CODE_SERVER_PASSWORD=your-secret\n\n" +
      "Or bind to localhost only (default):\n" +
      "  ax-code serve",
  )
  process.exit(1)
}
