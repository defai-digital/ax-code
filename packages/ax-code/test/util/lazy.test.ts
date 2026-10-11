import { describe, expect, test } from "vitest"
import { lazy } from "../../src/util/lazy"

describe("util.lazy", () => {
  test("should call function only once", () => {
    let callCount = 0
    const getValue = () => {
      callCount++
      return "expensive value"
    }

    const lazyValue = lazy(getValue)

    expect(callCount).toBe(0)

    const result1 = lazyValue()
    expect(result1).toBe("expensive value")
    expect(callCount).toBe(1)

    const result2 = lazyValue()
    expect(result2).toBe("expensive value")
    expect(callCount).toBe(1)
  })

  test("should preserve the same reference", () => {
    const obj = { value: 42 }
    const lazyObj = lazy(() => obj)

    const result1 = lazyObj()
    const result2 = lazyObj()

    expect(result1).toBe(obj)
    expect(result2).toBe(obj)
    expect(result1).toBe(result2)
  })

  test("peek observes an initialized value without triggering initialization", () => {
    let calls = 0
    const value = lazy(() => {
      calls++
      return { ready: true }
    })

    expect(value.loaded()).toBe(false)
    expect(value.peek()).toBeUndefined()
    expect(calls).toBe(0)

    const initialized = value()
    expect(value.loaded()).toBe(true)
    expect(value.peek()).toBe(initialized)

    value.reset()
    expect(value.loaded()).toBe(false)
    expect(value.peek()).toBeUndefined()
  })

  test("retries an async initializer after its promise rejects", async () => {
    let calls = 0
    const value = lazy(async () => {
      calls++
      if (calls === 1) throw new Error("transient")
      return "ready"
    })
    await expect(value()).rejects.toThrow("transient")
    expect(value.loaded()).toBe(false)
    await expect(value()).resolves.toBe("ready")
    expect(calls).toBe(2)
    await expect(value()).resolves.toBe("ready")
    expect(calls).toBe(2)
  })

  test("retries a function-valued thenable after it rejects", async () => {
    let calls = 0
    const value = lazy(() => {
      calls++
      const thenable = Object.assign(() => undefined, {
        then: (onFulfilled: (v: string) => void, onRejected: (e: unknown) => void) =>
          calls === 1 ? onRejected?.(new Error("transient")) : onFulfilled?.("ready"),
      })
      return thenable
    })
    await expect(Promise.resolve(value())).rejects.toThrow("transient")
    expect(value.loaded()).toBe(false)
    await expect(Promise.resolve(value())).resolves.toBe("ready")
  })

  test("retries when a thenable's then itself throws", () => {
    let calls = 0
    const value = lazy(() => {
      calls++
      const attempt = calls
      return {
        get then() {
          if (attempt === 1) throw new Error("broken thenable")
          return (onFulfilled?: (v: string) => void) => onFulfilled?.("ready")
        },
      }
    })
    expect(() => value()).toThrow("broken thenable")
    expect(value.loaded()).toBe(false)
    expect(value.peek()).toBeUndefined()
    const second = value() as unknown as PromiseLike<string>
    expect(value.loaded()).toBe(true)
    let resolved: string | undefined
    second.then((v) => (resolved = v))
    expect(resolved).toBe("ready")
    expect(calls).toBe(2)
  })

  test("should work with different return types", () => {
    const lazyString = lazy(() => "string")
    const lazyNumber = lazy(() => 123)
    const lazyBoolean = lazy(() => true)
    const lazyNull = lazy(() => null)
    const lazyUndefined = lazy(() => undefined)

    expect(lazyString()).toBe("string")
    expect(lazyNumber()).toBe(123)
    expect(lazyBoolean()).toBe(true)
    expect(lazyNull()).toBe(null)
    expect(lazyUndefined()).toBe(undefined)
  })
})
