import { randomBytes } from "crypto"

export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export namespace Identifier {
  const LENGTH = 26
  const COUNTER_MODULO = 0x1000

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
    if (currentTimestamp < lastTimestamp) currentTimestamp = lastTimestamp

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    } else if (counter === COUNTER_MODULO - 1) {
      // Preserve sort order when the 12-bit counter wraps by
      // bumping the timestamp into the next millisecond slot.
      lastTimestamp += 1
      counter = 0
      currentTimestamp = lastTimestamp
    }
    counter = (counter + 1) & (COUNTER_MODULO - 1)

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    return timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }
}
