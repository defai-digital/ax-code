import { describe, expect, test } from "vitest"
import { Capture, CapturedWritableStream } from "../src/lib/output.capture.js"

const drain = () => new Promise((resolve) => setTimeout(resolve, 20))

describe("CapturedWritableStream", () => {
  test("a throwing write listener does not wedge the stream", async () => {
    const capture = new Capture()
    const stream = new CapturedWritableStream("stdout", capture)
    const boom = () => {
      throw new Error("boom")
    }
    capture.on("write", boom)
    expect(() => stream.write("a")).toThrow("boom")
    capture.off("write", boom)
    stream.write("b")
    await drain()
    expect(capture.claimOutput()).toBe("ab")
  })

  test("multi-byte characters split across writes survive", async () => {
    const capture = new Capture()
    const stream = new CapturedWritableStream("stdout", capture)
    const bytes = Buffer.from("界")
    stream.write(bytes.subarray(0, 1))
    stream.write(bytes.subarray(1))
    await drain()
    expect(capture.claimOutput()).toBe("界")
  })

  test("a truncated tail still flushes as replacement at end", async () => {
    const capture = new Capture()
    const stream = new CapturedWritableStream("stdout", capture)
    stream.write(Buffer.from([0xe7]))
    await new Promise<void>((resolve) => stream.end(resolve))
    expect(capture.claimOutput()).toBe("\uFFFD")
  })
})
