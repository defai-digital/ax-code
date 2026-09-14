import { createHash } from "node:crypto"

type Snapshot = { hash: string; length: number; text: string; bytes: number }

// Bounds retained source payload, including conservative string/key accounting.
// Eviction does not close a server document: the next update sends full text.
export class ContentCache {
  private entries = new Map<string, Snapshot>()
  bytes = 0
  constructor(
    private readonly maxBytes: number,
    private readonly maxEntries = 1000,
  ) {}
  get size() {
    return this.entries.size
  }
  get(key: string) {
    return this.entries.get(key)
  }
  delete(key: string) {
    const entry = this.entries.get(key)
    if (entry) this.bytes -= entry.bytes
    return this.entries.delete(key)
  }
  clear() {
    this.entries.clear()
    this.bytes = 0
  }
  set(key: string, text: string) {
    this.delete(key)
    const bytes = Math.max(Buffer.byteLength(text), text.length * 2) + key.length * 2 + 128
    if (bytes > this.maxBytes) return
    while (this.entries.size && (this.bytes + bytes > this.maxBytes || this.entries.size >= this.maxEntries)) {
      this.delete(this.entries.keys().next().value!)
    }
    this.entries.set(key, { hash: ContentCache.hash(text), length: text.length, text, bytes })
    this.bytes += bytes
  }
  static hash(text: string) {
    return createHash("sha256").update(text).digest("hex").slice(0, 16)
  }
}
