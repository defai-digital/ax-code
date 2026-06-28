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
type NetworkOptionsWithRawArgv = NetworkOptions & { __axCodeRawArgv?: string[] }

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export async function resolveNetworkOptions(
  args: NetworkOptions,
  rawArgv = (args as NetworkOptionsWithRawArgv).__axCodeRawArgv ?? process.argv,
) {
  const config = await Config.global()
  // Detect both the space form (`--port 80`) and the equals form (`--port=80`).
  // Direct callers can pass argv, and CLI handlers receive the parser's raw
  // argv from boot middleware. This keeps programmatic cli(argv) parsing from
  // depending on the host process argv.
  const flagExplicitlySet = (flag: string, options?: { boolean?: boolean }) =>
    rawArgv.some((arg) => {
      if (arg === flag || arg.startsWith(`${flag}=`)) return true
      if (!options?.boolean) return false
      const negated = `--no-${flag.slice(2)}`
      return arg === negated
    })
  const portExplicitlySet = flagExplicitlySet("--port")
  const hostnameExplicitlySet = flagExplicitlySet("--hostname")
  const mdnsExplicitlySet = flagExplicitlySet("--mdns", { boolean: true })
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
