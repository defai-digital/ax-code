import { describe, expect, test, vi } from "vitest"
import { scheduleRendererPaintMilestone } from "./rendererPaintMilestone"

describe("scheduleRendererPaintMilestone", () => {
  test("records observed paint timing once", () => {
    let onPaint = () => {}
    let onFrame = () => {}
    let scheduled = () => {}
    const disconnect = vi.fn()
    const record = vi.fn()

    scheduleRendererPaintMilestone({
      readPaintEntries: () => [
        { name: "first-paint", startTime: 12.6 },
        { name: "first-contentful-paint", startTime: 19.2 },
      ],
      observePaint: (callback) => {
        onPaint = callback
        return { disconnect }
      },
      requestFrame: (callback) => {
        onFrame = callback
      },
      schedule: (callback) => {
        scheduled = callback
      },
      record,
    })

    onPaint()
    onFrame()
    scheduled()

    expect(record).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledWith({ firstPaintMs: 13, firstContentfulPaintMs: 19 })
    expect(disconnect).toHaveBeenCalledOnce()
  })

  test("records a frame fallback when no paint entry arrives", () => {
    let onFrame = () => {}
    let scheduled = () => {}
    const record = vi.fn()

    scheduleRendererPaintMilestone({
      readPaintEntries: () => [],
      observePaint: () => ({ disconnect: vi.fn() }),
      requestFrame: (callback) => {
        onFrame = callback
      },
      schedule: (callback) => {
        scheduled = callback
      },
      record,
    })

    onFrame()
    scheduled()

    expect(record).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledWith({ firstPaintMs: null, firstContentfulPaintMs: null })
  })
})
