/**
 * API key encryption module
 * Ported from ax-cli's encryption.ts
 *
 * Uses AES-256-GCM with PBKDF2 key derivation for encrypting API keys at rest.
 * Keys are derived from a machine-specific identifier (hostname + platform + arch).
 *
 * Security model:
 * - Protects against casual exposure (config file left open, accidental sharing)
 * - Does NOT protect against determined attackers with machine access
 * - Encrypted keys are tied to the machine they were encrypted on
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto"
import os from "os"

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const SALT_LENGTH = 32 // 256 bits
const AUTH_TAG_LENGTH = 16 // 128 bits
const PBKDF2_ITERATIONS = 600_000 // OWASP 2024 recommendation
const PBKDF2_LEGACY_ITERATIONS = 100_000 // backward compat
const ENCRYPTION_VERSION = 1

export interface EncryptedValue {
  encrypted: string // base64 ciphertext
  iv: string // base64 IV
  salt: string // base64 salt
  tag: string // base64 auth tag
  version: number
}

function machineId(): string {
  return `${os.hostname()}-${os.platform()}-${os.arch()}`
}

function deriveKey(salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(machineId(), salt, iterations, KEY_LENGTH, "sha256")
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 */
export function encrypt(plaintext: string): EncryptedValue {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(salt, PBKDF2_ITERATIONS)

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
    version: ENCRYPTION_VERSION,
  }
}

/**
 * Decrypt an encrypted value back to plaintext
 * Tries current iterations first, falls back to legacy for backward compat.
 *
 * The current-iteration catch block swallows the error so the function
 * can silently upgrade old ciphertexts (encrypted with
 * PBKDF2_LEGACY_ITERATIONS) without failing. This is intentional backward
 * compatibility, but we log at debug level so genuine corruption is still
 * traceable via logs — previously the failure was completely invisible.
 */
export function decrypt(value: EncryptedValue): string {
  const encrypted = Buffer.from(value.encrypted, "base64")
  const iv = Buffer.from(value.iv, "base64")
  const tag = Buffer.from(value.tag, "base64")
  // Legacy entries lack an explicit salt field. For those, the IV was
  // used as the salt during encryption. iv.subarray(0, SALT_LENGTH)
  // returns only 16 bytes (IV_LENGTH) instead of the full 32-byte
  // SALT_LENGTH — this is a known limitation preserved for backward
  // compatibility. Callers should re-encrypt via encrypt() to migrate
  // legacy entries to a proper 32-byte random salt.
  const salt = value.salt ? Buffer.from(value.salt, "base64") : iv.subarray(0, SALT_LENGTH)

  // Try current iterations first
  try {
    return decryptWith(encrypted, iv, salt, tag, PBKDF2_ITERATIONS)
  } catch (err) {
    // Fall back to legacy iterations. If this also fails, the original
    // legacy error propagates to the caller (no swallow).
    // eslint-disable-next-line no-console
    console.debug("auth/encryption: decrypt with current iterations failed, retrying with legacy", { err })
    return decryptWith(encrypted, iv, salt, tag, PBKDF2_LEGACY_ITERATIONS)
  }
}

function decryptWith(encrypted: Buffer, iv: Buffer, salt: Buffer, tag: Buffer, iterations: number): string {
  const key = deriveKey(salt, iterations)
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}

/**
 * Check if an encrypted value uses the legacy salt derivation (no explicit salt field).
 * Legacy entries should be re-encrypted via encrypt() to use a proper 32-byte random salt.
 */
export function isLegacySalt(value: EncryptedValue): boolean {
  return !value.salt
}

/**
 * Type guard: check if a value looks like an EncryptedValue
 */
export function isEncrypted(value: unknown): value is EncryptedValue {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.encrypted === "string" &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.version === "number"
  )
}

/**
 * Encrypt a specific field in an object if it's a plaintext string
 */
export function encryptField<T extends Record<string, unknown>>(obj: T, field: string): T {
  const val = obj[field]
  if (typeof val !== "string" || val === "") return obj
  if (isEncrypted(val)) return obj // already encrypted
  return { ...obj, [field]: encrypt(val) }
}

/**
 * Decrypt a specific field in an object if it's encrypted.
 *
 * On decryption failure the field is set to `undefined` so callers see
 * a plain-typed value instead of a still-encrypted object shape.
 * Previously this returned the original object unchanged, which meant
 * downstream code that expected a decrypted string received an
 * `EncryptedValue` and silently produced wrong behavior — masking real
 * data corruption.
 */
export function decryptField<T extends Record<string, unknown>>(obj: T, field: string): T {
  const val = obj[field]
  if (!isEncrypted(val)) return obj
  try {
    const plaintext = decrypt(val)
    if (isLegacySalt(val)) {
      // Re-encrypt with a proper 32-byte random salt to migrate legacy entries
      return { ...obj, [field]: plaintext, __needsReEncrypt: true }
    }
    return { ...obj, [field]: plaintext }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`auth/encryption: failed to decrypt field "${field}"`, err)
    return { ...obj, [field]: undefined }
  }
}

/**
 * Test encryption round-trip
 */
export function test(): boolean {
  try {
    const plain = "test-api-key-12345"
    const enc = encrypt(plain)
    return decrypt(enc) === plain
  } catch {
    return false
  }
}
