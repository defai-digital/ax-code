// Pure layout math for the session top bar. Kept component-free so the
// collapse order stays testable next to the other session view models.

import { stringWidth } from "@/bun/node-compat"
import { truncateToCellWidth } from "./last-input-view-model"

export interface SessionTopBarSegments {
  id: string
  title?: string
  status?: string
  share?: string
  providers?: string
  manage?: string
}

export interface SessionTopBarLayout {
  id: string
  title?: string
  status?: string
  share?: string
  providers?: string
  manage?: string
}

const GAP = 2
const MIN_ID_WIDTH = 8
const MIN_TITLE_WIDTH = 12

/**
 * Fits the session top bar segments into the available cell width. The
 * session id anchors the left side and truncates last; the share URL, title,
 * and status label are dropped in that order as space runs out (status keeps
 * priority because it carries the live "working" signal). Status and share
 * render whole or not at all, while the title truncates down to a minimum.
 * The providers block survives as long as it physically fits because it is
 * the bar's only entry point to the provider manager; its "manage" link drops
 * first under extreme narrowness since the count itself stays clickable.
 */
export function sessionTopBarLayout(input: { width: number; segments: SessionTopBarSegments }): SessionTopBarLayout {
  const { segments } = input
  // A non-finite width would slip through Math.max and turn every later
  // comparison false, so treat it as "no room" instead.
  const width = Number.isFinite(input.width) ? Math.max(0, Math.floor(input.width)) : 0
  const result: SessionTopBarLayout = { id: "" }

  let providers = segments.providers || undefined
  let manage = providers ? segments.manage || undefined : undefined
  const rightWidth = (withManage: boolean) =>
    (providers ? stringWidth(providers) : 0) + (withManage && manage ? GAP + stringWidth(manage) : 0)
  if (manage && providers && width < rightWidth(true) + GAP + MIN_ID_WIDTH) manage = undefined
  // The providers block only survives while it physically fits; below that
  // there is nothing left to anchor and the id takes whatever remains.
  if (providers && width < rightWidth(false)) providers = undefined
  const right = providers ? rightWidth(Boolean(manage)) : 0

  let remaining = width - right - (right > 0 ? GAP : 0)

  const idWidth = Math.min(stringWidth(segments.id), Math.max(0, remaining))
  result.id = truncateToCellWidth(segments.id, idWidth)
  remaining -= stringWidth(result.id)

  const take = (text: string | undefined, options: { min: number; truncate: boolean }): string | undefined => {
    if (!text) return undefined
    const budget = remaining - GAP
    if (budget < options.min) return undefined
    if (!options.truncate && stringWidth(text) > budget) return undefined
    const fitted = options.truncate ? truncateToCellWidth(text, budget) : text
    remaining = budget - stringWidth(fitted)
    return fitted
  }

  result.status = take(segments.status, { min: segments.status ? stringWidth(segments.status) : 0, truncate: false })
  // A title shorter than the truncation floor still fits whole; only long
  // titles need the floor so they never truncate down to an unreadable stub.
  result.title = take(segments.title, {
    min: segments.title ? Math.min(MIN_TITLE_WIDTH, stringWidth(segments.title)) : 0,
    truncate: true,
  })
  result.share = take(segments.share, { min: segments.share ? stringWidth(segments.share) : 0, truncate: false })

  result.providers = providers
  result.manage = manage
  return result
}
