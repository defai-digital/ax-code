/**
 * In-stream repetition guard.
 *
 * The existing loop guards (doom-loop cycle detection, repeated-failure
 * trace, tool-only turn caps) all operate on *completed* turns. A model that
 * falls into a repetition loop inside a single streaming response — local
 * quantized models do this readily on repetitive edit tasks — produces none
 * of those signals: tokens keep flowing, the heartbeat stays fresh, and the
 * TUI spins forever with no error.
 *
 * This guard watches the raw text/reasoning deltas of one stream and detects
 * two repetition shapes inside a sliding tail window:
 *
 * - `segment`: the same paragraph (>= MIN_SEGMENT_CHARS) appears
 *   MAX_SEGMENT_REPEATS+ times in the window. Catches the common "same plan
 *   sentence re-emitted between re-reads of the same code" loop.
 * - `tail`: the window ends with the same short unit repeated back-to-back.
 *   Catches single-line streams with no paragraph breaks ("foo foo foo ...").
 *
 * Checks are throttled (every CHECK_INTERVAL_CHARS appended, only after
 * MIN_TOTAL_CHARS total) so the per-delta cost stays negligible.
 */
export namespace StreamRepetition {
  /** Don't evaluate anything until this much text has streamed. */
  export const MIN_TOTAL_CHARS = 4096
  /** Sliding window kept for analysis. */
  export const WINDOW_CHARS = 6144
  /** Run the checks at most once per this many appended chars. */
  export const CHECK_INTERVAL_CHARS = 512
  /** Paragraphs shorter than this are ignored by the segment check. */
  export const MIN_SEGMENT_CHARS = 40
  /** A paragraph appearing this many times in the window is a loop. */
  export const MAX_SEGMENT_REPEATS = 3
  /** Shortest / longest unit considered by the back-to-back tail check. */
  export const MIN_TAIL_UNIT_CHARS = 30
  export const MAX_TAIL_UNIT_CHARS = 600
  /** Consecutive repeats of the unit required at the tail. */
  export const MIN_TAIL_REPEATS = 3
  /** Cap on anchor occurrences scanned per tail check (cost bound). */
  const MAX_ANCHOR_OCCURRENCES = 16

  export type Detection = {
    kind: "segment" | "tail"
    /** The repeated unit, truncated for display. */
    unit: string
    count: number
  }

  export type Options = {
    minTotalChars?: number
    windowChars?: number
    checkIntervalChars?: number
    minSegmentChars?: number
    maxSegmentRepeats?: number
    minTailUnitChars?: number
    maxTailUnitChars?: number
    minTailRepeats?: number
  }

  function normalizeSegment(raw: string): string {
    return raw.trim().replace(/\s+/g, " ")
  }

  function detectSegmentRepeat(window: string, minSegmentChars: number, maxRepeats: number): Detection | undefined {
    const segments = window.split(/\n+/)
    const counts = new Map<string, number>()
    for (const raw of segments) {
      const segment = normalizeSegment(raw)
      if (segment.length < minSegmentChars) continue
      const count = (counts.get(segment) ?? 0) + 1
      if (count > maxRepeats) {
        return { kind: "segment", unit: segment.slice(0, 200), count }
      }
      counts.set(segment, count)
    }
    return undefined
  }

  function detectTailRepeat(
    window: string,
    minUnitChars: number,
    maxUnitChars: number,
    minRepeats: number,
  ): Detection | undefined {
    const anchor = window.slice(-minUnitChars)
    if (anchor.length < minUnitChars) return undefined
    const anchorStart = window.length - minUnitChars
    // Scan anchor occurrences backwards from the tail: the closest one yields
    // the smallest candidate period, which is the loop's true unit. Scanning
    // forwards would hit far-away occurrences first whose periods exceed
    // maxUnitChars and exhaust the scan budget before reaching the real one.
    let from = anchorStart - 1
    let scanned = 0
    while (scanned < MAX_ANCHOR_OCCURRENCES) {
      const p = window.lastIndexOf(anchor, from)
      if (p === -1) break
      scanned++
      from = p - 1
      // In a periodic string the anchor recurs exactly at the period, so the
      // distance from this occurrence to the tail anchor is a candidate period.
      const period = anchorStart - p
      if (period > maxUnitChars) break // periods only grow from here backwards
      if (period < minUnitChars) continue
      const unit = window.slice(window.length - period)
      // Verify the window ends with >= minRepeats consecutive copies of the unit.
      const runLength = period * minRepeats
      if (runLength > window.length) continue
      const tail = window.slice(window.length - runLength)
      if (tail === unit.repeat(minRepeats)) {
        let count = minRepeats
        while (window.length - (count + 1) * period >= 0) {
          const prev = window.slice(window.length - (count + 1) * period, window.length - count * period)
          if (prev !== unit) break
          count++
        }
        return { kind: "tail", unit: unit.slice(0, 200), count }
      }
    }
    return undefined
  }

  export function create(options: Options = {}) {
    const minTotalChars = options.minTotalChars ?? MIN_TOTAL_CHARS
    const windowChars = options.windowChars ?? WINDOW_CHARS
    const checkIntervalChars = options.checkIntervalChars ?? CHECK_INTERVAL_CHARS
    const minSegmentChars = options.minSegmentChars ?? MIN_SEGMENT_CHARS
    const maxSegmentRepeats = options.maxSegmentRepeats ?? MAX_SEGMENT_REPEATS
    const minTailUnitChars = options.minTailUnitChars ?? MIN_TAIL_UNIT_CHARS
    const maxTailUnitChars = options.maxTailUnitChars ?? MAX_TAIL_UNIT_CHARS
    const minTailRepeats = options.minTailRepeats ?? MIN_TAIL_REPEATS

    let total = 0
    let window = ""
    let sinceCheck = 0

    return {
      /** Feed one streamed delta. Returns a Detection the first time a loop trips. */
      push(delta: string): Detection | undefined {
        total += delta.length
        window = window.length + delta.length > windowChars ? (window + delta).slice(-windowChars) : window + delta
        sinceCheck += delta.length
        if (total < minTotalChars || sinceCheck < checkIntervalChars) return undefined
        sinceCheck = 0
        return (
          detectSegmentRepeat(window, minSegmentChars, maxSegmentRepeats) ??
          detectTailRepeat(window, minTailUnitChars, maxTailUnitChars, minTailRepeats)
        )
      },
      /** Reset accumulated state (e.g. at a new step within the same stream). */
      reset() {
        total = 0
        window = ""
        sinceCheck = 0
      },
    }
  }

  /** Characters of a looped part kept when persisting the aborted turn. */
  export const TRUNCATED_LOOP_HEAD_CHARS = 2000

  /**
   * Truncate text captured from a looped stream before it is persisted.
   * Keeping the full repetition would re-induce the same pattern when the
   * aborted message is fed back on retry, and bloats storage — the head
   * (usually the model's actual plan) is the only part worth keeping.
   */
  export function truncateLoopedText(text: string, headChars = TRUNCATED_LOOP_HEAD_CHARS): string {
    if (text.length <= headChars) return text
    const omitted = text.length - headChars
    return (
      text.slice(0, headChars) +
      `\n\n[${omitted} characters omitted: repetitive output removed by the output-loop guard]`
    )
  }
}
