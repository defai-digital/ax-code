const NETWORK_BIND_FLAGS = ["--port", "--hostname", "--mdns"] as const

export function hasExplicitNetworkBindFlag(argv: readonly string[] = process.argv) {
  return NETWORK_BIND_FLAGS.some((flag) => argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`)))
}
