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
 * The providers block always survives because it is the bar's only entry
 * point to the provider manager; its "manage" link drops under extreme
 * narrowness since the count itself stays clickable.
 */
export function sessionTopBarLayout(input: { width: number; segments: SessionTopBarSegments }): SessionTopBarLayout {
  const { segments } = input
  const width = Math.max(0, input.width)
  const result: SessionTopBarLayout = { id: "" }

  const providers = segments.providers
  let manage = providers ? segments.manage : undefined
  const rightWidth = (withManage: boolean) =>
    (providers ? stringWidth(providers) : 0) + (withManage && manage ? GAP + stringWidth(manage) : 0)
  if (manage && providers && width < rightWidth(true) + GAP + MIN_ID_WIDTH) manage = undefined
  const right = providers ? rightWidth(Boolean(manage)) : 0

  let remaining = width - right - (right > 0 ? GAP : 0)

  const idWidth = Math.min(stringWidth(segments.id), Math.max(0, remaining))
  result.id = truncateToCellWidth(segments.id, idWidth)
  remaining -= idWidth

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
  result.title = take(segments.title, { min: MIN_TITLE_WIDTH, truncate: true })
  result.share = take(segments.share, { min: segments.share ? stringWidth(segments.share) : 0, truncate: false })

  result.providers = providers
  result.manage = manage
  return result
}
