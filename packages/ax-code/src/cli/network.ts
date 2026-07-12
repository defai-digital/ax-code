import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { isLoopbackHostname, normalizeLoopbackHostname, normalizeLoopbackHttpOrigin } from "../runtime/listen-security"

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
    describe: "mDNS discovery is unavailable in local-only builds",
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
    describe: "additional loopback origins to allow for CORS",
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
  const corsExplicitlySet = flagExplicitlySet("--cors")

  const requestedMdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const requestedHostname = hostnameExplicitlySet ? args.hostname : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const requestedCors = [...configCors, ...argsCors]

  if (mdnsExplicitlySet && requestedMdns) {
    throw new Error("mDNS discovery is disabled by the local-only policy")
  }
  if (hostnameExplicitlySet && !isLoopbackHostname(requestedHostname)) {
    throw new Error("--hostname must be a loopback address; remote AX Code access is disabled by the local-only policy")
  }
  const rejectedCors = requestedCors.filter((origin) => !normalizeLoopbackHttpOrigin(origin))
  if (corsExplicitlySet && rejectedCors.length > 0) {
    throw new Error(`--cors only accepts loopback origins; rejected ${rejectedCors.join(", ")}`)
  }

  const hostname = isLoopbackHostname(requestedHostname) ? normalizeLoopbackHostname(requestedHostname) : "127.0.0.1"
  const cors = requestedCors.map(normalizeLoopbackHttpOrigin).filter((origin): origin is string => origin !== null)
  return { hostname, port, mdns: false, mdnsDomain, cors }
}

export function isLocalhostOnly(hostname: string) {
  return isLoopbackHostname(hostname)
}

export function requireAuthForNetwork(hostname: string) {
  if (isLocalhostOnly(hostname)) return
  console.error(
    "Error: AX Code is local-only and cannot bind to a network address.\n" +
      `  hostname: ${hostname}\n\n` +
      "Bind to localhost only (default):\n" +
      "  ax-code serve",
  )
  process.exit(1)
}
