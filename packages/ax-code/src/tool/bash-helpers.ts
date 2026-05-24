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

  let end = maxBytes
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString("utf8")
}

export function truncateBashMetadata(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input
  return truncateUtf8ByBytes(input, maxBytes) + "\n\n..."
}
