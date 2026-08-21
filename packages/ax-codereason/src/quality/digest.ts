import { createHash } from "crypto"

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

export function sha256JsonHex(input: unknown) {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) {
    throw new TypeError("Cannot hash a non-JSON value")
  }
  return sha256Hex(serialized)
}
