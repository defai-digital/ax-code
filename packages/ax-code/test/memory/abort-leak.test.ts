import { describe, test, expect } from "bun:test"

const MB = 1024 * 1024

const getHeapMB = () => {
  Bun.gc(true)
  return process.memoryUsage().heapUsed / MB
}

describe("memory: closure vs bind pattern", () => {
  test("bind pattern does not retain closure scope", () => {
    const ITERATIONS = 200

    // OLD pattern: arrow function closure retains surrounding scope
    const closureMap = new Map<number, () => void>()
    const timers: Timer[] = []

    Bun.gc(true)
    const baseline = getHeapMB()

    for (let i = 0; i < ITERATIONS; i++) {
      const content = "x".repeat(50 * 1024) // 50KB captured by closure
      const controller = new AbortController()
      const handler = () => { if (content.length > 1e9) controller.abort() }
      closureMap.set(i, handler)
      timers.push(setTimeout(handler, 30000))
    }

    Bun.gc(true)
    const oldGrowth = getHeapMB() - baseline

    // Cleanup
    timers.forEach(clearTimeout)
    closureMap.clear()

    // NEW pattern: bind doesn't capture surrounding scope
    Bun.gc(true)
    const baseline2 = getHeapMB()
    const handlers: (() => void)[] = []
    const timers2: Timer[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      const _content = "x".repeat(50 * 1024) // 50KB NOT captured
      const controller = new AbortController()
      const handler = controller.abort.bind(controller)
      handlers.push(handler)
      timers2.push(setTimeout(handler, 30000))
    }

    Bun.gc(true)
    const newGrowth = getHeapMB() - baseline2

    // Cleanup
    timers2.forEach(clearTimeout)
    handlers.length = 0

    console.log(`Closure pattern: ${oldGrowth.toFixed(2)} MB growth`)
    console.log(`Bind pattern: ${newGrowth.toFixed(2)} MB growth`)

    expect(newGrowth).toBeLessThanOrEqual(oldGrowth)
  })
})
