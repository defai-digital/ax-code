import { createHash, createPublicKey, verify } from "node:crypto"

// Keep aligned with docs/release/ax-minisign.pub and both standalone installers.
// This is the published Minisign verifying key, not a credential.
export const RELEASE_PUBLIC_KEY = "RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO"

function decode(value: string, size: number) {
  const bytes = Buffer.from(value, "base64")
  if (bytes.length !== size || bytes.toString("base64") !== value) {
    throw new Error("Invalid Minisign encoding")
  }
  return bytes
}

/** Verify the Minisign envelope using Node's Ed25519 and BLAKE2b primitives.
 * Format reference: jedisct1/minisign, sig_load() and sig_verify().
 * The trusted comment has its own signature; the untrusted comment is ignored.
 */
export function verifyMinisign(body: Uint8Array, envelope: string, publicKey = RELEASE_PUBLIC_KEY): void {
  if (envelope.length > 8192) throw new Error("Minisign signature is too large")
  const lines = envelope.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n")
  if (lines.length !== 4 || !lines[0].startsWith("untrusted comment: ") || !lines[2].startsWith("trusted comment: ")) {
    throw new Error("Invalid Minisign signature envelope")
  }
  const key = decode(publicKey, 42)
  const signature = decode(lines[1], 74)
  const globalSignature = decode(lines[3], 64)
  const algorithm = signature.subarray(0, 2).toString("latin1")
  if (key.subarray(0, 2).toString("latin1") !== "Ed" || (algorithm !== "ED" && algorithm !== "Ed")) {
    throw new Error("Unsupported Minisign algorithm")
  }
  if (!key.subarray(2, 10).equals(signature.subarray(2, 10))) throw new Error("Minisign key ID mismatch")
  const verifier = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der",
    type: "spki",
  })
  const detached = signature.subarray(10)
  const message = algorithm === "ED" ? createHash("blake2b512").update(body).digest() : body
  const comment = Buffer.from(lines[2].slice("trusted comment: ".length), "utf8")
  if (
    !verify(null, message, verifier, detached) ||
    !verify(null, Buffer.concat([detached, comment]), verifier, globalSignature)
  ) {
    throw new Error("Minisign signature verification failed")
  }
}
