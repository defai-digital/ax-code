import { cliBooleanFlagValue } from "@/cli/boolean-flag"

const NETWORK_BIND_FLAGS = ["--port", "--hostname", "--mdns"] as const

export function hasExplicitNetworkBindFlag(argv: readonly string[] = process.argv) {
  return NETWORK_BIND_FLAGS.some((flag) => {
    if (flag === "--mdns") return cliBooleanFlagValue(argv, flag) === true
    return argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
  })
}
