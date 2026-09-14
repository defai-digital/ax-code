import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** Transient, process-owned output. Synchronous bounded I/O avoids queued writes and close/read races. */
export class BackgroundOutputSpool {
  static readonly capacity = 2 * 1024 * 1024
  // Reserve a complete ring per open file: physical file contents cannot exceed 64 MiB.
  static readonly maxFiles = 32
  private static directory: string | undefined
  private static sequence = 0
  private static files = new Set<BackgroundOutputSpool>()

  integrity: "complete" | "dropped" | "expired" | "storage_error" = "complete"
  private fd: number | undefined
  private file: string | undefined
  private head = 0
  private size = 0
  private dropped = false
  finishedAt: number | undefined

  get unreadBytes() {
    return this.size
  }

  private open() {
    if (this.fd !== undefined) return
    if (BackgroundOutputSpool.files.size >= BackgroundOutputSpool.maxFiles) {
      const oldest = [...BackgroundOutputSpool.files]
        .filter((spool) => spool.finishedAt !== undefined)
        .sort((a, b) => a.finishedAt! - b.finishedAt!)[0]
      oldest?.expire()
    }
    if (BackgroundOutputSpool.files.size >= BackgroundOutputSpool.maxFiles) throw new Error("Spool capacity exhausted")
    if (!BackgroundOutputSpool.directory) {
      BackgroundOutputSpool.directory = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-background-"))
      fs.chmodSync(BackgroundOutputSpool.directory, 0o700)
    }
    this.file = path.join(BackgroundOutputSpool.directory, `${++BackgroundOutputSpool.sequence}.output`)
    this.fd = fs.openSync(this.file, "wx+", 0o600)
    BackgroundOutputSpool.files.add(this)
  }

  append(text: string) {
    if (this.integrity === "storage_error" || this.integrity === "expired" || !text) return
    try {
      this.open()
      // Bound temporary encoding even when a producer supplies one enormous string.
      let start = Math.max(0, text.length - BackgroundOutputSpool.capacity)
      if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start++
      let bytes = Buffer.from(text.slice(start), "utf8")
      if (text.length > BackgroundOutputSpool.capacity || bytes.length > BackgroundOutputSpool.capacity) {
        this.markDropped()
      }
      if (bytes.length > BackgroundOutputSpool.capacity) bytes = bytes.subarray(-BackgroundOutputSpool.capacity)
      const overflow = Math.max(0, this.size + bytes.length - BackgroundOutputSpool.capacity)
      if (overflow) {
        this.head = (this.head + overflow) % BackgroundOutputSpool.capacity
        this.size -= overflow
        this.markDropped()
      }
      let position = (this.head + this.size) % BackgroundOutputSpool.capacity
      let offset = 0
      while (offset < bytes.length) {
        const length = Math.min(bytes.length - offset, BackgroundOutputSpool.capacity - position)
        const written = fs.writeSync(this.fd!, bytes, offset, length, position)
        if (!written) throw new Error("Spool write made no progress")
        offset += written
        position = (position + written) % BackgroundOutputSpool.capacity
      }
      this.size += bytes.length
    } catch {
      this.fail()
    }
  }

  private markDropped() {
    this.dropped = true
    this.integrity = "dropped"
  }

  private fail() {
    this.integrity = "storage_error"
    this.dropped = true
    this.release()
  }

  read(): { output: string; dropped: boolean } {
    let output = ""
    try {
      if (this.size && this.fd !== undefined) {
        const bytes = Buffer.allocUnsafe(this.size)
        let offset = 0
        let position = this.head
        while (offset < bytes.length) {
          const length = Math.min(bytes.length - offset, BackgroundOutputSpool.capacity - position)
          const count = fs.readSync(this.fd, bytes, offset, length, position)
          if (!count) throw new Error("Spool output is incomplete")
          offset += count
          position = (position + count) % BackgroundOutputSpool.capacity
        }
        // The oldest edge of a rolling ring can land inside a UTF-8 character.
        let start = 0
        while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
        output = bytes.toString("utf8", start)
      }
    } catch {
      this.fail()
    }
    this.release()
    const dropped = this.dropped || this.integrity === "expired" || this.integrity === "storage_error"
    this.dropped = false
    return { output, dropped }
  }

  expire() {
    this.integrity = "expired"
    this.dropped = true
    this.release()
  }

  dispose() {
    this.release()
  }

  private release() {
    this.size = 0
    this.head = 0
    if (this.fd !== undefined) {
      try {
        fs.closeSync(this.fd)
      } catch {
        this.integrity = "storage_error"
        // Retain the descriptor reservation for a later cleanup retry.
        return
      }
      this.fd = undefined
    }
    if (this.file) {
      try {
        fs.unlinkSync(this.file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          // Keep its reservation until cleanup succeeds: failed unlink must not bypass the disk cap.
          this.integrity = "storage_error"
          return
        }
      }
      this.file = undefined
    }
    BackgroundOutputSpool.files.delete(this)
    if (BackgroundOutputSpool.files.size === 0 && BackgroundOutputSpool.directory) {
      try {
        fs.rmdirSync(BackgroundOutputSpool.directory)
        BackgroundOutputSpool.directory = undefined
      } catch {
        // A later release/reset retries only this process's private directory.
      }
    }
  }

  static reset() {
    for (const spool of [...this.files]) spool.dispose()
  }

  static statsForTests() {
    return { directory: this.directory, files: this.files.size, reservedBytes: this.files.size * this.capacity }
  }
}

process.once("exit", () => BackgroundOutputSpool.reset())
