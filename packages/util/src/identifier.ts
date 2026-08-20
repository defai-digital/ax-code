import { randomBytes } from "crypto"

export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export namespace Identifier {
  const LENGTH = 26
  const TIME_BYTES = 7
  const TIME_HEX_LENGTH = TIME_BYTES * 2
  const COUNTER_MODULO = 0x1000
  const MAX_TIMESTAMP = 2 ** 44 - 1
  const ASCENDING_VERSION_MARKER = "z"
  const DESCENDING_VERSION_MARKER = "-"

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending() {
    return create(false)
  }

  export function descending() {
    return create(true)
  }

  function randomBase62(length: number): string {
    // Rejection sampling: `256 % 62 = 8`, so a naive `byte % 62` gives
    // the first 8 characters a slightly higher probability. Only accept
    // bytes below the largest multiple of 62 <= 256 (which is 248), rejecting
    // the rest.
    const limit = BASE62_ALPHABET.length * Math.floor(256 / BASE62_ALPHABET.length)
    let result = ""
    while (result.length < length) {
      const bytes = randomBytes(length * 2)
      for (let i = 0; i < bytes.length && result.length < length; i++) {
        const byte = bytes[i]
        if (byte < limit) {
          result += BASE62_ALPHABET[byte % BASE62_ALPHABET.length]
        }
      }
    }
    return result
  }

  export function create(descending: boolean, timestamp?: number): string {
    let currentTimestamp = timestamp ?? Date.now()
    if (!Number.isSafeInteger(currentTimestamp) || currentTimestamp < 0 || currentTimestamp > MAX_TIMESTAMP) {
      throw new RangeError(`Invalid identifier timestamp: ${currentTimestamp}`)
    }
    if (currentTimestamp < lastTimestamp) currentTimestamp = lastTimestamp

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    } else if (counter === COUNTER_MODULO - 1) {
      // Preserve sort order when the 12-bit counter wraps by
      // bumping the timestamp into the next millisecond slot.
      if (lastTimestamp === MAX_TIMESTAMP) throw new RangeError("Identifier timestamp capacity exhausted")
      lastTimestamp += 1
      counter = 0
      currentTimestamp = lastTimestamp
    }
    counter = (counter + 1) & (COUNTER_MODULO - 1)

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(TIME_BYTES)
    for (let i = 0; i < TIME_BYTES; i++) {
      timeBytes[i] = Number((now >> BigInt((TIME_BYTES - 1 - i) * 8)) & BigInt(0xff))
    }

    const marker = descending ? DESCENDING_VERSION_MARKER : ASCENDING_VERSION_MARKER
    return marker + timeBytes.toString("hex") + randomBase62(LENGTH - TIME_HEX_LENGTH - 1)
  }
}
