export type RendererPaintEntry = {
  name: string
  startTime: number
}

export type RendererPaintObserver = {
  disconnect: () => void
}

export type RendererPaintMilestoneOptions = {
  readPaintEntries: () => readonly RendererPaintEntry[]
  observePaint?: (onPaint: () => void) => RendererPaintObserver
  requestFrame: (callback: () => void) => void
  schedule: (callback: () => void) => void
  record: (details: { firstPaintMs: number | null; firstContentfulPaintMs: number | null }) => void | Promise<void>
}

export const scheduleRendererPaintMilestone = (options: RendererPaintMilestoneOptions): void => {
  let reported = false
  let observer: RendererPaintObserver | null = null

  const reportPaint = () => {
    if (reported) return
    reported = true
    observer?.disconnect()

    let paints: readonly RendererPaintEntry[] = []
    try {
      paints = options.readPaintEntries()
    } catch {
      // The milestone still matters when the Paint Timing API is unavailable.
    }

    const firstPaint = paints.find((entry) => entry.name === "first-paint")
    const firstContentfulPaint = paints.find((entry) => entry.name === "first-contentful-paint")
    void options.record({
      firstPaintMs: firstPaint ? Math.round(firstPaint.startTime) : null,
      firstContentfulPaintMs: firstContentfulPaint ? Math.round(firstContentfulPaint.startTime) : null,
    })
  }

  if (options.observePaint) {
    try {
      observer = options.observePaint(reportPaint)
    } catch {
      observer = null
    }
  }

  // Custom renderer schemes do not always emit Paint Timing entries. A frame
  // callback is still a reliable renderer milestone, and the one-shot guard
  // prevents a later observer callback from recording it twice.
  options.requestFrame(() => options.schedule(reportPaint))
}
