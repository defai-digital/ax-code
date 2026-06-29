export const DEFAULT_TERMINAL_COLS = 80
export const DEFAULT_TERMINAL_ROWS = 24
export const MAX_TERMINAL_DIMENSION = 1000

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

export function parseTerminalDimension(value, fieldName) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim())
        : NaN

  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) {
    return { ok: false, error: `${fieldName} must be an integer` }
  }

  if (numberValue < 1 || numberValue > MAX_TERMINAL_DIMENSION) {
    return { ok: false, error: `${fieldName} must be between 1 and ${MAX_TERMINAL_DIMENSION}` }
  }

  return { ok: true, value: numberValue }
}

export function resolveTerminalDimensions(input, options = {}) {
  const source = input && typeof input === "object" ? input : {}
  const requireBoth = options.requireBoth === true
  const defaults = {
    cols: options.defaultCols ?? DEFAULT_TERMINAL_COLS,
    rows: options.defaultRows ?? DEFAULT_TERMINAL_ROWS,
  }

  const resolved = {}
  for (const fieldName of ["cols", "rows"]) {
    const provided = hasOwn(source, fieldName) && source[fieldName] !== undefined
    if (!provided) {
      if (requireBoth) {
        return { ok: false, error: "cols and rows are required" }
      }
      resolved[fieldName] = defaults[fieldName]
      continue
    }

    const parsed = parseTerminalDimension(source[fieldName], fieldName)
    if (!parsed.ok) {
      return parsed
    }
    resolved[fieldName] = parsed.value
  }

  return { ok: true, cols: resolved.cols, rows: resolved.rows }
}
