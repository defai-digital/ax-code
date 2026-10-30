import type { Clock, TimerHandle } from "../lib/clock.js"

interface ScheduledTimer {
  id: number
  fireAt: number
  order: number
  delayMs: number
  repeat: boolean
  fn: () => void
}

function compareTimers(left: ScheduledTimer, right: ScheduledTimer): number {
  if (left.fireAt !== right.fireAt) {
    return left.fireAt - right.fireAt
  }

  return left.order - right.order
}

export class ManualClock implements Clock {
  private time = 0
  private nextId = 1
  private nextOrder = 0
  private readonly timers = new Map<number, ScheduledTimer>()

  public now(): number {
    return this.time
  }

  public setTime(time: number): void {
    const targetTime = Math.floor(time)

    if (targetTime >= this.time) {
      this.advance(targetTime - this.time)
      return
    }

    this.time = targetTime
  }

  public setTimeout(fn: () => void, delayMs: number): TimerHandle {
    return this.schedule(fn, delayMs, false)
  }

  public clearTimeout(handle: TimerHandle): void {
    this.timers.delete(Number(handle))
  }

  public setInterval(fn: () => void, delayMs: number): TimerHandle {
    return this.schedule(fn, delayMs, true)
  }

  public clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle)
  }

  public advance(delayMs: number): void {
    const targetTime = this.time + Math.max(0, Math.floor(delayMs))
    // Zero-delay intervals reschedule at the current time; without a cap they
    // would fire forever inside a single advance. Fire each at most once per
    // advance and leave it pending for the next one.
    const firedZeroDelayIntervals = new Set<number>()

    while (true) {
      const nextTimer = this.peekNextTimer(firedZeroDelayIntervals)
      if (!nextTimer || nextTimer.fireAt > targetTime) {
        break
      }

      this.time = Math.max(this.time, nextTimer.fireAt)
      if (nextTimer.repeat) {
        if (nextTimer.delayMs === 0) {
          firedZeroDelayIntervals.add(nextTimer.id)
        }
        this.timers.set(nextTimer.id, {
          ...nextTimer,
          fireAt: this.time + nextTimer.delayMs,
          order: this.nextOrder++,
        })
      } else {
        this.timers.delete(nextTimer.id)
      }
      // Keep the next interval registered while user code runs so cancellation
      // from inside the callback removes it instead of being undone afterward.
      nextTimer.fn()
    }

    this.time = targetTime
  }

  public runAll(): void {
    while (true) {
      const nextTimer = this.peekNextTimer()
      if (!nextTimer) {
        return
      }

      this.advance(nextTimer.fireAt - this.time)
    }
  }

  private schedule(fn: () => void, delayMs: number, repeat: boolean): number {
    const id = this.nextId++
    const normalizedDelay = Math.max(0, Math.floor(delayMs))
    this.timers.set(id, {
      id,
      fireAt: this.time + normalizedDelay,
      order: this.nextOrder++,
      delayMs: normalizedDelay,
      repeat,
      fn,
    })
    return id
  }

  private peekNextTimer(excludeIds?: Set<number>): ScheduledTimer | null {
    let nextTimer: ScheduledTimer | null = null
    for (const timer of this.timers.values()) {
      if (excludeIds?.has(timer.id)) continue
      if (!nextTimer || compareTimers(timer, nextTimer) < 0) {
        nextTimer = timer
      }
    }

    return nextTimer
  }
}
