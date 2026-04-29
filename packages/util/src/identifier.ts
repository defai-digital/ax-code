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
    let result = ""
    const bytes = randomBytes(length)
    for (let i = 0; i < length; i++) {
      result += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length]
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
