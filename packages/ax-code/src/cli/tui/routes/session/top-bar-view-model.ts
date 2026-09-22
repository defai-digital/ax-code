// Pure layout math for the session top bar. The session title and live status
// take precedence over technical identifiers as the terminal gets narrower.

import { stringWidth } from "@/bun/node-compat"
import { truncateToCellWidth } from "./last-input-view-model"

export interface SessionTopBarSegments {
  id: string
  title?: string
  status?: string
  share?: string
  providers?: string
}

export interface SessionTopBarLayout {
  id?: string
  title?: string
  status?: string
  share?: string
  providers?: string
}

const GAP = 2
const MIN_MAIN_WIDTH = 10
const MIN_STATUS_WIDTH = 8
const MIN_ID_WIDTH = 8

export function sessionTopBarLayout(input: { width: number; segments: SessionTopBarSegments }): SessionTopBarLayout {
  const { segments } = input
  const width = Number.isFinite(input.width) ? Math.max(0, Math.floor(input.width)) : 0
  const result: SessionTopBarLayout = {}
  if (width === 0) return result

  // Provider management has one visible entry. Drop it before shrinking the
  // title and live status below useful minimums.
  const providerWidth = segments.providers ? stringWidth(segments.providers) : 0
  const minimumMain = segments.title && segments.status ? MIN_MAIN_WIDTH + GAP + MIN_STATUS_WIDTH : MIN_MAIN_WIDTH
  if (providerWidth && width >= providerWidth + GAP + minimumMain) result.providers = segments.providers
  let remaining = width - (result.providers ? providerWidth + GAP : 0)

  // A running status gets a small reserved budget, while the title receives
  // the rest. On very narrow terminals the title survives on its own.
  const main = segments.title || segments.status || segments.id
  const hasSeparateStatus = Boolean(segments.title && segments.status)
  const reserveStatus = hasSeparateStatus && remaining >= MIN_MAIN_WIDTH + GAP + MIN_STATUS_WIDTH
  const mainBudget = remaining - (reserveStatus ? GAP + MIN_STATUS_WIDTH : 0)
  const fittedMain = truncateToCellWidth(main, Math.min(stringWidth(main), mainBudget))
  if (segments.title) result.title = fittedMain
  else if (segments.status) result.status = fittedMain
  else result.id = fittedMain
  remaining -= stringWidth(fittedMain)

  if (segments.title && segments.status && remaining >= GAP + MIN_STATUS_WIDTH) {
    result.status = truncateToCellWidth(segments.status, Math.min(stringWidth(segments.status), remaining - GAP))
    remaining -= GAP + stringWidth(result.status)
  }

  if (segments.id && result.id === undefined && remaining >= GAP + MIN_ID_WIDTH) {
    result.id = truncateToCellWidth(segments.id, remaining - GAP)
    remaining -= GAP + stringWidth(result.id)
  }

  if (segments.share && remaining >= GAP + stringWidth(segments.share)) result.share = segments.share
  return result
}
