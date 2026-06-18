import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { isLoopbackHostname } from "../runtime/listen-security"

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
  // Detect both the space form (`--port 80`) and the equals form (`--port=80`).
  // `process.argv.includes(flag)` only matches the space form, so an explicit
  // `--port=80` was treated as unset and silently overridden by config/defaults.
  const flagExplicitlySet = (flag: string) => process.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
  const portExplicitlySet = flagExplicitlySet("--port")
  const hostnameExplicitlySet = flagExplicitlySet("--hostname")
  const mdnsExplicitlySet = flagExplicitlySet("--mdns")
  const mdnsDomainExplicitlySet = flagExplicitlySet("--mdns-domain")

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

export function isLocalhostOnly(hostname: string) {
  return isLoopbackHostname(hostname)
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
