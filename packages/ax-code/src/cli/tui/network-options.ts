import type { Argv } from "yargs"

// Network listen flags for the default TUI command. Kept separate from
// cli/network.ts so `$0` registration does not import config.
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

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}
