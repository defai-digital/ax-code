export function hasDynamicShellExpansion(value: string) {
  return /\$\(|\$\{|`/.test(value)
}

export function assertStaticRedirectTarget(target: string) {
  if (hasDynamicShellExpansion(target)) {
    throw new Error("Dynamic redirection targets are not allowed")
  }
}

export function stripShellQuotes(value: string) {
  return value.replace(/^"(.*)"$|^'(.*)'$/s, "$1$2")
}

export function isStaticPathArg(value: string) {
  const stripped = stripShellQuotes(value)
  if (!stripped || hasDynamicShellExpansion(stripped)) return undefined
  return stripped
}

function positionalArgs(args: string[]) {
  const result: string[] = []
  let afterSeparator = false
  for (const arg of args) {
    if (!afterSeparator && arg === "--") {
      afterSeparator = true
      continue
    }
    if (!afterSeparator && arg.startsWith("-")) continue
    result.push(arg)
  }
  return result
}

function hasAnyFlag(args: string[], flags: string[]) {
  for (const arg of args) {
    if (arg === "--") return false
    if (flags.includes(arg)) return true

    const shortFlagGroup = arg.startsWith("-") && !arg.startsWith("--")
    if (shortFlagGroup && flags.some((flag) => flag.length === 2 && arg.includes(flag[1]!))) return true
  }
  return false
}

export function staticallyCheckablePathArgs(cmd: string, args: string[]) {
  const positional = positionalArgs(args)
  switch (cmd) {
    case "cd":
      return positional.slice(0, 1)
    case "cat":
      return positional
    case "rm":
      if (hasAnyFlag(args, ["-f", "--force"])) return []
      return positional
    case "mv":
    case "cp":
      return positional.length > 1 ? positional.slice(0, -1) : positional
    default:
      return []
  }
}

export function hasDynamicRedirection(command: string) {
  return /(?:^|[\s&;])\d*>>?\s*(?:\$\(|\$\{|`)/.test(command)
}

export function absolutePathLiterals(value: string) {
  return Array.from(value.matchAll(/["'](\/[^"']+)["']/g), (match) => match[1]).filter(Boolean)
}

function truncateUtf8ByBytes(input: string, maxBytes: number): string {
  const bytes = Buffer.from(input, "utf8")
  if (bytes.byteLength <= maxBytes) return input

  const end = safeUtf8PrefixLength(bytes, maxBytes)
  return bytes.subarray(0, end).toString("utf8")
}

export function truncateBashMetadata(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input
  return truncateUtf8ByBytes(input, maxBytes) + "\n\n..."
}

export function safeUtf8PrefixLength(chunk: Buffer, maxBytes: number): number {
  const bounded = Math.min(Math.max(0, maxBytes), chunk.length)
  let end = 0
  for (let index = 0; index < bounded; ) {
    const byte = chunk[index]!
    let width = 0
    if ((byte & 0x80) === 0) width = 1
    else if ((byte & 0xe0) === 0xc0) width = 2
    else if ((byte & 0xf0) === 0xe0) width = 3
    else if ((byte & 0xf8) === 0xf0) width = 4
    if (width === 0 || index + width > bounded) break
    end = index + width
    index = end
  }
  return end
}

export function refProcessIfAvailable(proc: { ref?: unknown }): boolean {
  if (typeof proc.ref !== "function") return false
  proc.ref()
  return true
}
