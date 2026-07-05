import { createHash } from "crypto"

export namespace Hash {
  export function fast(input: string | Buffer): string {
    return createHash("sha256").update(input).digest("hex")
  }
}
