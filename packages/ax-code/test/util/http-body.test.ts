import { describe, expect, test } from "vitest"
import { BodyTooLargeError, readBoundedBody } from "../../src/util/http-body"

describe("readBoundedBody", () => {
  test("rejects an oversized body without waiting for transport cancellation", async () => {
    let finishCancellation!: () => void
    let cancellationStarted!: () => void
    const cancelling = new Promise<void>((resolve) => (cancellationStarted = resolve))
    const cancellation = new Promise<void>((resolve) => (finishCancellation = resolve))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5))
      },
      cancel() {
        cancellationStarted()
        return cancellation
      },
    })
    const response = new Response(stream)
    let error: unknown
    const reading = readBoundedBody(response, 4).catch((reason) => {
      error = reason
    })
    try {
      await cancelling
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(error).toBeInstanceOf(BodyTooLargeError)
      expect(stream.locked).toBe(false)
    } finally {
      finishCancellation()
      await reading
    }
  })

  test("accepts a body exactly at the limit", async () => {
    await expect(readBoundedBody(new Response(new Uint8Array([1, 2, 3, 4])), 4)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
  })

  test("preserves the size error when cancellation rejects", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5))
      },
      cancel() {
        return Promise.reject(new Error("Transport cancellation failed"))
      },
    })
    await expect(readBoundedBody(new Response(stream), 4)).rejects.toBeInstanceOf(BodyTooLargeError)
    expect(stream.locked).toBe(false)
  })
})
