/**
 * Presentation helpers for model variants (reasoning effort / thinking budget).
 *
 * Wire protocol stays OpenCode-compatible (`variant` keys from the provider).
 * UI copy uses "effort" / "thinking" language so users are not forced to learn
 * provider-specific jargon, without inventing a separate product mode axis.
 */

export type EffortOption = {
  /** Provider wire key, or undefined for Auto (no explicit variant). */
  value: string | undefined
  /** Short friendly label for chips and menus. */
  label: string
  /** One-line guidance for pickers. */
  description: string
  /** Raw provider key shown as secondary text when different from label. */
  detail?: string
}

const KNOWN: Record<string, { label: string; description: string }> = {
  none: {
    label: "Off",
    description: "No extra reasoning budget",
  },
  minimal: {
    label: "Minimal",
    description: "Bare-minimum reasoning for the fastest replies",
  },
  low: {
    label: "Fast",
    description: "Faster and cheaper for simple, scoped edits",
  },
  medium: {
    label: "Balanced",
    description: "Everyday balance of quality, speed, and cost",
  },
  high: {
    label: "Deep",
    description: "Deeper reasoning for complex multi-step work",
  },
  xhigh: {
    label: "Max",
    description: "Highest common reasoning level (higher cost)",
  },
  max: {
    label: "Max",
    description: "Maximum thinking budget (higher cost and latency)",
  },
  deep: {
    label: "Deep",
    description: "Deeper reasoning for complex multi-step work",
  },
  xdeep: {
    label: "Max",
    description: "Maximum thinking budget (higher cost and latency)",
  },
  thinking: {
    label: "Thinking",
    description: "Provider thinking mode enabled",
  },
  default: {
    label: "Default",
    description: "Provider default effort for this model",
  },
  auto: {
    label: "Auto",
    description: "Use model default; AX may still raise depth when needed",
  },
}

function titleCase(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Friendly label for a wire variant key. Undefined means Auto. */
export function effortLabel(variant: string | undefined): string {
  if (variant === undefined || variant === "") return "Auto"
  const known = KNOWN[variant.toLowerCase()]
  if (known) return known.label
  return titleCase(variant)
}

/** One-line description for pickers and tooltips. */
export function effortDescription(variant: string | undefined): string {
  if (variant === undefined || variant === "") {
    return KNOWN.auto.description
  }
  const known = KNOWN[variant.toLowerCase()]
  if (known) return known.description
  return `Provider effort level "${variant}"`
}

/**
 * Compact display for status chips.
 * Known keys show the friendly label only; unknown keys keep the wire name.
 * Auto shows "Auto".
 */
export function effortDisplay(variant: string | undefined): string {
  return effortLabel(variant)
}

/** Toast / status line after the user changes effort. */
export function effortChangeMessage(variant: string | undefined): string {
  if (variant === undefined || variant === "") {
    return "Effort → Auto (model default)"
  }
  const label = effortLabel(variant)
  const key = variant.toLowerCase()
  if (KNOWN[key] && KNOWN[key].label.toLowerCase() !== key) {
    return `Effort → ${label} (${variant})`
  }
  return `Effort → ${label}`
}

/**
 * Build picker options from a model's available variant keys.
 * Always prepends Auto (undefined) so users can clear an override.
 */
export function effortOptions(variantKeys: readonly string[]): EffortOption[] {
  const seen = new Set<string>()
  const options: EffortOption[] = [
    {
      value: undefined,
      label: "Auto",
      description: KNOWN.auto.description,
    },
  ]

  for (const key of variantKeys) {
    if (!key || seen.has(key)) continue
    seen.add(key)
    const label = effortLabel(key)
    options.push({
      value: key,
      label,
      description: effortDescription(key),
      detail: label.toLowerCase() === key.toLowerCase() ? undefined : key,
    })
  }

  return options
}

/**
 * Keep a stored variant only if the active model still exposes it.
 * Returns undefined when the key is missing (falls back to Auto).
 */
export function clampEffort(
  variant: string | undefined,
  available: readonly string[],
): string | undefined {
  if (variant === undefined || variant === "") return undefined
  if (available.includes(variant)) return variant
  return undefined
}
