import { Writable } from "stream"
import { EventEmitter } from "events"
import { StringDecoder } from "string_decoder"

export type CapturedOutput = {
  stream: "stdout" | "stderr"
  output: string
}

export class Capture extends EventEmitter {
  // TODO: Cache could rather be a buffer to avoid join()?
  private output: CapturedOutput[] = []

  constructor() {
    super()
  }

  get size(): number {
    return this.output.length
  }

  write(stream: "stdout" | "stderr", data: string): void {
    this.output.push({ stream, output: data })
    this.emit("write", stream, data)
  }

  claimOutput() {
    const output = this.output.map((o) => o.output).join("")
    this.clear()
    return output
  }

  private clear(): void {
    this.output = []
  }
}

export class CapturedWritableStream extends Writable {
  public isTTY: boolean = true
  public columns: number = process.stdout.columns || 80
  public rows: number = process.stdout.rows || 24

  private decoder = new StringDecoder("utf8")

  constructor(
    private stream: "stdout" | "stderr",
    private capture: Capture,
  ) {
    super()
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const data = Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk)
    try {
      this.capture.write(this.stream, data)
    } finally {
      callback()
    }
  }

  _final(callback: (error?: Error | null) => void): void {
    const rest = this.decoder.end()
    try {
      if (rest) this.capture.write(this.stream, rest)
    } finally {
      callback()
    }
  }

  getColorDepth(): number {
    return process.stdout.getColorDepth?.() || 8
  }
}
