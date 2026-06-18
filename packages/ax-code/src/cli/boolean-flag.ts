const TRUE_VALUES = new Set(["", "1", "true", "yes", "on"])
const FALSE_VALUES = new Set(["0", "false", "no", "off"])

export function cliBooleanFlagValue(argv: readonly string[], flag: `--${string}`): boolean | undefined {
  let value: boolean | undefined
  const negative = `--no-${flag.slice(2)}`
  const assignmentPrefix = `${flag}=`

  for (const arg of argv) {
    if (arg === flag) {
      value = true
      continue
    }
    if (arg === negative) {
      value = false
      continue
    }
    if (!arg.startsWith(assignmentPrefix)) continue

    const raw = arg.slice(assignmentPrefix.length).trim().toLowerCase()
    if (TRUE_VALUES.has(raw)) value = true
    if (FALSE_VALUES.has(raw)) value = false
  }

  return value
}
