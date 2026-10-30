/**
 * Internal TextTable column-width fitting.
 *
 * This module is intentionally NOT re-exported from `lib/index.ts`: it stays
 * an internal detail so the public package surface is unchanged. The fitting
 * strategies are pure so they can be unit-tested without constructing a
 * renderable.
 *
 * @module
 */

/**
 * Normalize a column width to a positive integer.
 *
 * Non-finite widths (`NaN`, `±Infinity`) resolve to `1` instead of poisoning
 * every downstream total with `NaN`.
 */
export function normalizeColumnWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1
}

/** Sum a list of column widths. */
export function sumWidths(widths: readonly number[]): number {
  let total = 0
  for (const width of widths) total += width
  return total
}

/** Allocate per-column shrink amounts weighted by shrinkable slack. */
export function allocateShrinkByWeight(shrinkable: number[], targetShrink: number, mode: "linear" | "sqrt"): number[] {
  const shrink = new Array(shrinkable.length).fill(0)

  if (targetShrink <= 0) {
    return shrink
  }

  const weights = shrinkable.map((value) => {
    if (value <= 0) {
      return 0
    }

    return mode === "sqrt" ? Math.sqrt(value) : value
  })
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)

  if (totalWeight <= 0) {
    return shrink
  }

  const fractions = new Array(shrinkable.length).fill(0)
  let usedShrink = 0

  for (let idx = 0; idx < shrinkable.length; idx++) {
    if (shrinkable[idx] <= 0 || weights[idx] <= 0) continue

    const exact = (weights[idx] / totalWeight) * targetShrink
    const whole = Math.min(shrinkable[idx], Math.floor(exact))
    shrink[idx] = whole
    fractions[idx] = exact - whole
    usedShrink += whole
  }

  let remainingShrink = targetShrink - usedShrink

  while (remainingShrink > 0) {
    let bestIdx = -1
    let bestFraction = -1

    for (let idx = 0; idx < shrinkable.length; idx++) {
      if (shrinkable[idx] - shrink[idx] <= 0) continue

      if (
        bestIdx === -1 ||
        fractions[idx] > bestFraction ||
        (fractions[idx] === bestFraction && shrinkable[idx] > shrinkable[bestIdx])
      ) {
        bestIdx = idx
        bestFraction = fractions[idx]
      }
    }

    if (bestIdx === -1) {
      break
    }

    shrink[bestIdx] += 1
    fractions[bestIdx] = 0
    remainingShrink -= 1
  }

  return shrink
}

/**
 * Proportional fitting: shrink columns toward their preferred minimum
 * (content width capped at `minWidth + 1`), distributing the reduction by
 * exact proportional share with largest-remainder rounding.
 */
export function fitColumnWidthsProportional(
  widths: number[],
  targetContentWidth: number,
  minWidth: number,
  columnMinWidths?: readonly number[],
): number[] {
  const hardMinWidths = widths.map((_, idx) => Math.max(minWidth, columnMinWidths?.[idx] ?? minWidth))
  const baseWidths = widths.map(normalizeColumnWidth)

  const preferredMinWidths = baseWidths.map((width, idx) =>
    Math.min(width, Math.max(minWidth + 1, hardMinWidths[idx]!)),
  )
  const preferredMinTotal = sumWidths(preferredMinWidths)

  const floorWidths = preferredMinTotal <= targetContentWidth ? preferredMinWidths : hardMinWidths
  const floorTotal = sumWidths(floorWidths)
  const clampedTarget = Math.max(floorTotal, targetContentWidth)

  const totalBaseWidth = sumWidths(baseWidths)

  if (totalBaseWidth <= clampedTarget) {
    return baseWidths
  }

  const shrinkable = baseWidths.map((width, idx) => width - floorWidths[idx])
  const totalShrinkable = sumWidths(shrinkable)
  if (totalShrinkable <= 0) {
    return [...floorWidths]
  }

  const targetShrink = totalBaseWidth - clampedTarget
  const integerShrink = new Array(baseWidths.length).fill(0)
  const fractions = new Array(baseWidths.length).fill(0)
  let usedShrink = 0

  for (let idx = 0; idx < baseWidths.length; idx++) {
    if (shrinkable[idx] <= 0) continue

    const exact = (shrinkable[idx] / totalShrinkable) * targetShrink
    const whole = Math.min(shrinkable[idx], Math.floor(exact))
    integerShrink[idx] = whole
    fractions[idx] = exact - whole
    usedShrink += whole
  }

  let remainingShrink = targetShrink - usedShrink

  while (remainingShrink > 0) {
    let bestIdx = -1
    let bestFraction = -1

    for (let idx = 0; idx < baseWidths.length; idx++) {
      if (shrinkable[idx] - integerShrink[idx] <= 0) continue
      if (fractions[idx] > bestFraction) {
        bestFraction = fractions[idx]
        bestIdx = idx
      }
    }

    if (bestIdx === -1) break

    integerShrink[bestIdx] += 1
    fractions[bestIdx] = 0
    remainingShrink -= 1
  }

  return baseWidths.map((width, idx) => Math.max(floorWidths[idx], width - integerShrink[idx]))
}

/**
 * Balanced fitting: even out columns toward a shared width before shrinking
 * the residual by square-root-weighted allocation.
 */
export function fitColumnWidthsBalanced(
  widths: number[],
  targetContentWidth: number,
  minWidth: number,
  columnMinWidths?: readonly number[],
): number[] {
  const hardMinWidths = widths.map((_, idx) => Math.max(minWidth, columnMinWidths?.[idx] ?? minWidth))
  const baseWidths = widths.map(normalizeColumnWidth)
  const totalBaseWidth = sumWidths(baseWidths)
  const columns = baseWidths.length

  if (columns === 0 || totalBaseWidth <= targetContentWidth) {
    return baseWidths
  }

  const evenShare = Math.max(minWidth, Math.floor(targetContentWidth / columns))
  const preferredMinWidths = baseWidths.map((width, idx) =>
    Math.min(width, Math.max(evenShare, hardMinWidths[idx]!)),
  )
  const preferredMinTotal = sumWidths(preferredMinWidths)
  const floorWidths = preferredMinTotal <= targetContentWidth ? preferredMinWidths : hardMinWidths
  const floorTotal = sumWidths(floorWidths)
  const clampedTarget = Math.max(floorTotal, targetContentWidth)

  if (totalBaseWidth <= clampedTarget) {
    return baseWidths
  }

  const shrinkable = baseWidths.map((width, idx) => width - floorWidths[idx])
  const totalShrinkable = sumWidths(shrinkable)
  if (totalShrinkable <= 0) {
    return [...floorWidths]
  }

  const targetShrink = totalBaseWidth - clampedTarget
  const shrink = allocateShrinkByWeight(shrinkable, targetShrink, "sqrt")

  return baseWidths.map((width, idx) => Math.max(floorWidths[idx], width - shrink[idx]))
}
