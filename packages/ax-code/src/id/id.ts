import z from "zod"
import { randomBytes } from "crypto"
import { BASE62_ALPHABET } from "@ax-code/util/identifier"

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
    code_intel_lsp_cache: "lsc",
    code_symbol_note: "csn",
    refactor_plan: "rpl",
    embedding_cache: "ebc",
    audit_semantic_call: "asc",
    debug_pattern: "dpt",
    task_queue: "tsk",
    scheduled_task: "sch",
    workflow_run: "wfr",
    workflow_phase: "wfp",
    workflow_child: "wfc",
    workflow_artifact: "wfa",
    workflow_budget: "wfb",
  } as const

  export type Prefix = keyof typeof prefixes

  export function schema(prefix: Prefix) {
    return z.string().startsWith(prefixes[prefix] + "_")
  }

  const LENGTH = 26
  const TIME_BYTES = 7
  const TIME_HEX_LENGTH = TIME_BYTES * 2
  const LEGACY_TIME_HEX_LENGTH = 12
  const COUNTER_MODULO = 0x1000
  const MAX_TIMESTAMP = 2 ** 44 - 1
  const ASCENDING_VERSION_MARKER = "z"
  const DESCENDING_VERSION_MARKER = "-"

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending(prefix: Prefix, given?: string) {
    return generateID(prefix, false, given)
  }

  export function descending(prefix: Prefix, given?: string) {
    return generateID(prefix, true, given)
  }

  function generateID(prefix: Prefix, descending: boolean, given?: string): string {
    if (!given) {
      return create(prefix, descending)
    }

    if (!given.startsWith(prefixes[prefix] + "_")) {
      throw new Error(`ID ${given} does not start with ${prefixes[prefix]}_`)
    }
    return given
  }

  function randomBase62(length: number): string {
    // Rejection sampling: `256 % 62 = 8`, so a naive `byte % 62` gives the
    // first 8 characters a slightly higher probability. Only accept bytes
    // below the largest multiple of 62 <= 256 (which is 248), rejecting
    // the rest. Oversample to keep the expected number of crypto reads
    // bounded even when many rejections happen.
    const limit = BASE62_ALPHABET.length * Math.floor(256 / BASE62_ALPHABET.length)
    let result = ""
    while (result.length < length) {
      const bytes = randomBytes(length * 2)
      for (let i = 0; i < bytes.length && result.length < length; i++) {
        const byte = bytes[i]!
        if (byte < limit) result += BASE62_ALPHABET[byte % BASE62_ALPHABET.length]
      }
    }
    return result
  }

  export function create(prefix: Prefix, descending: boolean, timestamp?: number): string {
    let currentTimestamp = timestamp ?? Date.now()
    if (!Number.isSafeInteger(currentTimestamp) || currentTimestamp < 0 || currentTimestamp > MAX_TIMESTAMP) {
      throw new RangeError(`Invalid identifier timestamp: ${currentTimestamp}`)
    }
    if (currentTimestamp < lastTimestamp) currentTimestamp = lastTimestamp

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    } else if (counter === COUNTER_MODULO - 1) {
      if (lastTimestamp === MAX_TIMESTAMP) throw new RangeError("Identifier timestamp capacity exhausted")
      lastTimestamp += 1
      currentTimestamp = lastTimestamp
      counter = 0
    }
    counter = (counter + 1) & (COUNTER_MODULO - 1)

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(TIME_BYTES)
    for (let i = 0; i < TIME_BYTES; i++) {
      timeBytes[i] = Number((now >> BigInt((TIME_BYTES - 1 - i) * 8)) & BigInt(0xff))
    }

    // Keep new IDs ordered correctly against every legacy payload: ascending
    // IDs start with `z` (after legacy hex), while descending IDs start with
    // `-` (before legacy hex). The marker also versions the widened key
    // without changing total ID length.
    const marker = descending ? DESCENDING_VERSION_MARKER : ASCENDING_VERSION_MARKER
    return prefixes[prefix] + "_" + marker + timeBytes.toString("hex") + randomBase62(LENGTH - TIME_HEX_LENGTH - 1)
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const separator = id.indexOf("_")
    if (separator <= 0) throw new Error(`Invalid identifier: ${id}`)
    const payload = id.slice(separator + 1)
    const widened =
      payload.startsWith(ASCENDING_VERSION_MARKER) &&
      new RegExp(`^[0-9a-f]{${TIME_HEX_LENGTH}}`, "i").test(payload.slice(1))
    const hexLength = widened ? TIME_HEX_LENGTH : LEGACY_TIME_HEX_LENGTH
    const hex = payload.slice(widened ? 1 : 0, hexLength + (widened ? 1 : 0))
    if (!new RegExp(`^[0-9a-f]{${hexLength}}$`, "i").test(hex)) throw new Error(`Invalid identifier: ${id}`)
    const encoded = BigInt("0x" + hex)
    // Use explicit right shift by 12 bits — both encodings pack a millisecond
    // timestamp in the high bits and a 12-bit counter in the low bits (see
    // `create` above where we compute
    // `BigInt(ts) * BigInt(0x1000) + BigInt(counter)`). Right shift matches
    // that construction exactly. Legacy timestamps remain truncated to their
    // original 36 bits; widened IDs preserve 44 timestamp bits.
    return Number(encoded >> BigInt(12))
  }
}
