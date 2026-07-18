/**
 * Presentation helpers for model variants (reasoning effort / thinking budget).
 * Keep in sync with packages/ax-code/src/provider/effort-label.ts
 */

const KNOWN: Record<string, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Fast",
  medium: "Balanced",
  high: "Deep",
  xhigh: "Max",
  max: "Max",
  deep: "Deep",
  xdeep: "Max",
  thinking: "Thinking",
  default: "Default",
  auto: "Auto",
}

function titleCase(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Friendly label for a wire variant key. Undefined means Auto/Default. */
export function effortLabel(variant: string | undefined, autoLabel = "Auto"): string {
  if (variant === undefined || variant === "") return autoLabel
  const known = KNOWN[variant.toLowerCase()]
  if (known) return known
  return titleCase(variant)
}
