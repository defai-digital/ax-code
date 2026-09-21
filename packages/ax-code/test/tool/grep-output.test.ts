import { describe, expect, test } from "vitest"
import { PassThrough } from "node:stream"
import { readGrepOutput } from "../../src/tool/grep-output"
import { Process } from "../../src/util/process"

function captured(chunks: Buffer[], close = false) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const proc = { stdout, stderr, exitCode: 0, signalCode: null, exited: Promise.resolve(0) } as unknown as Process.Child
  const lines: string[] = []
  const pending = readGrepOutput(proc, AbortSignal.any([]), (line) => lines.push(line))
  for (const chunk of chunks) stdout.write(chunk)
  if (close) stdout.destroy()
  else stdout.end()
  stderr.end()
  return pending.then((result) => ({ ...result, lines }))
}

describe("grep byte framing", () => {
  test("all split boundaries match bulk UTF-8 decoding, including invalid bytes and CRLF", async () => {
    const input = Buffer.concat([Buffer.from("first é 🦋\r\n\n"), Buffer.from([0xc3, 0xff, 0x0a]), Buffer.from("tail")])
    const expected = input.toString("utf8").split("\n").slice(0, -1)
    for (let i = 0; i <= input.length; i++) {
      const result = await captured([input.subarray(0, i), input.subarray(i)])
      expect(result.lines).toEqual(expected)
      expect(result.incompleteRecord).toBe(true)
      expect(result.bytes).toBe(input.length)
    }
    expect((await captured(Array.from(input, (byte) => Buffer.from([byte])))).lines).toEqual(expected)
  })

  test.each([false, true])("end and descriptor close preserve complete lines (close=%s)", async (close) => {
    expect(await captured([Buffer.from("one\ntwo\n")], close)).toMatchObject({
      lines: ["one", "two"],
      incompleteRecord: false,
      capped: false,
    })
  })

  test.each([-1, 0, 1])("preserves the raw 16 MiB cutoff with newline at offset %+i", async (offset) => {
    const cap = 16 * 1024 * 1024
    const input = Buffer.from("x".repeat(cap - 1 + offset) + "\n")
    // Already-exited fake process: the cap still stops collection, without OS effects.
    const result = await captured([input])
    expect(result.bytes).toBe(Math.min(input.length, cap))
    expect(result.capped).toBe(offset > 0)
    expect(result.incompleteRecord).toBe(offset > 0)
    expect(result.lines.length).toBe(offset > 0 ? 0 : 1)
  })

  test("overflow after an exact-budget complete frame remains capped", async () => {
    const result = await captured([Buffer.from("x".repeat(16 * 1024 * 1024 - 1) + "\n"), Buffer.from("extra")])
    expect(result.capped).toBe(true)
    expect(result.incompleteRecord).toBe(false)
    expect(result.lines).toHaveLength(1)
  })

  test("callback errors reject and reap a real still-running child", async () => {
    const proc = Process.spawn([process.execPath, "-e", 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    })
    await expect(
      readGrepOutput(proc, AbortSignal.any([]), () => {
        throw new Error("parser failure")
      }),
    ).rejects.toThrow("parser failure")
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true)
  })
})
