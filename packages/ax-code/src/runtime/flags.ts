export type RuntimeFlagOptions = {
  pid?: number
  preservePid?: boolean
}

/** Mark the current process as an AX Code runtime for tools and embedded callers. */
export function seedRuntimeFlags(env: Record<string, string | undefined>, options: RuntimeFlagOptions = {}): void {
  const pid = options.pid ?? process.pid
  env.AGENT = "1"
  env.AX_CODE = "1"
  env.OPENCODE = "1"
  if (options.preservePid) env.AX_CODE_PID ??= String(pid)
  else env.AX_CODE_PID = String(pid)
}
