import z from "zod"
import { randomBytes } from "crypto"

export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    question: "que",
    user: "usr",
    part: "prt",
    pty: "pty",
    tool: "tool",
    workspace: "wrk",
    event: "evt",
    code_node: "cnd",
    code_edge: "ced",
    code_file: "cfi",
    refactor_plan: "rpl",
    embedding_cache: "ebc",
  } as const

  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  const LENGTH = 26

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, false, given)
  }

  export function descending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, true, given)
  }

  function generateID(prefix: keyof typeof prefixes, descending: boolean, given?: string): string {
    if (!given) {
      return create(prefix, descending)
    }

    if (!given.startsWith(prefixes[prefix])) {
      throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
    }
    return given
  }

  function randomBase62(length: number): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    // Rejection sampling: `256 % 62 = 8`, so a naive `byte % 62` gives the
    // first 8 characters a slightly higher probability. Only accept bytes
    // below the largest multiple of 62 <= 256 (which is 248), rejecting
    // the rest. Oversample to keep the expected number of crypto reads
    // bounded even when many rejections happen.
    const limit = 248 // 62 * 4
    let result = ""
    while (result.length < length) {
      const bytes = randomBytes(length * 2)
      for (let i = 0; i < bytes.length && result.length < length; i++) {
        const byte = bytes[i]
        if (byte < limit) result += chars[byte % 62]
      }
    }
    return result
  }

  export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string {
    const currentTimestamp = timestamp ?? Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const prefix = id.split("_")[0]
    const hex = id.slice(prefix.length + 1, prefix.length + 13)
    const encoded = BigInt("0x" + hex)
    // Use explicit right shift by 12 bits — the encoding packs a 36-bit
    // millisecond timestamp in the high bits and a 12-bit counter in the
    // low bits (see `create` above where we compute
    // `BigInt(ts) * BigInt(0x1000) + BigInt(counter)`). Right shift matches
    // that construction exactly; the previous `/ BigInt(0x1000)` happened
    // to be numerically equivalent for positive values but obscured intent
    // and would silently break if the counter width ever changed.
    return Number(encoded >> BigInt(12))
  }
}
