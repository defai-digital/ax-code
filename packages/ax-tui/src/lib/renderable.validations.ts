import type { RenderableOptions, Renderable } from "../core/renderable.js"
import type { PositionTypeString, OverflowString } from "./yoga.options.js"

export function validateOptions(id: string, options: RenderableOptions<Renderable>): void {
  if (typeof options.width === "number") {
    if (!Number.isFinite(Math.fround(options.width)) || options.width < 0) {
      throw new TypeError(`Invalid width for Renderable ${id}: ${options.width}`)
    }
  }
  if (typeof options.height === "number") {
    if (!Number.isFinite(Math.fround(options.height)) || options.height < 0) {
      throw new TypeError(`Invalid height for Renderable ${id}: ${options.height}`)
    }
  }
}

export function isValidPercentage(value: any): value is `${number}%` {
  // The numeric part is factored as \d+(?:\.\d*)?|\.\d+ so a run of digits has
  // exactly one parse; the naive \d+\.?\d* alternation backtracks
  // quadratically on long digit runs that ultimately fail to match.
  if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%$/i.test(value)) {
    return Number.isFinite(Math.fround(Number(value.slice(0, -1))))
  }
  return false
}

export function isMarginType(value: any): value is number | "auto" | `${number}%` {
  if (typeof value === "number" && Number.isFinite(Math.fround(value))) {
    return true
  }
  if (value === "auto") {
    return true
  }
  return isValidPercentage(value)
}

export function isPaddingType(value: any): value is number | `${number}%` {
  if (typeof value === "number" ? value < 0 : typeof value === "string" && parseFloat(value) < 0) return false
  if (typeof value === "number" && Number.isFinite(Math.fround(value))) {
    return true
  }
  return isValidPercentage(value)
}

export function isPositionType(value: any): value is number | "auto" | `${number}%` {
  if (typeof value === "number" && Number.isFinite(Math.fround(value))) {
    return true
  }
  if (value === "auto") {
    return true
  }
  return isValidPercentage(value)
}

export function isPositionTypeType(value: any): value is PositionTypeString {
  return value === "relative" || value === "absolute"
}

export function isOverflowType(value: any): value is OverflowString {
  return value === "visible" || value === "hidden" || value === "scroll"
}

export function isDimensionType(value: any): value is number | "auto" | `${number}%` {
  return value === "auto" || isPaddingType(value)
}

export function isFlexBasisType(value: any): value is number | "auto" | undefined {
  if (value === undefined || value === "auto") {
    return true
  }
  if (typeof value === "number" && Number.isFinite(Math.fround(value))) {
    return true
  }
  return false
}

export function isSizeType(value: any): value is number | `${number}%` | undefined {
  if (value === undefined) {
    return true
  }
  if (typeof value === "number" && Number.isFinite(Math.fround(value))) {
    return true
  }
  return isValidPercentage(value)
}
