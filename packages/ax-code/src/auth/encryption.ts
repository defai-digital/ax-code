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
import { execFileSync } from "child_process"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import os from "os"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "../util/log"
import { NativePerf } from "@/perf/native"
import { Global } from "../global"

const log = Log.create({ service: "auth/encryption" })

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const SALT_LENGTH = 32 // 256 bits
const AUTH_TAG_LENGTH = 16 // 128 bits
const PBKDF2_ITERATIONS = 600_000 // OWASP 2024 recommendation (for the low-entropy legacy password)
const PBKDF2_LEGACY_ITERATIONS = 100_000 // backward compat
// Version 2: when the per-install secret exists, the derivation password
// contains 256 bits of randomness — PBKDF2 stretching adds nothing against
// brute force at that entropy (OWASP iteration guidance targets human
// passwords). 600k iterations cost ~35ms per field and Auth.all() decrypts
// every field, which made it the dominant startup cost. Keep a non-trivial
// count so v2 still goes through the same code path and remains
// indistinguishable on disk apart from the version number.
const PBKDF2_ITERATIONS_V2 = 10_000
const ENCRYPTION_VERSION = 2
const TEST_KEY_VALUE = "test-api-key-12345"

// Sentinel value encrypted alongside real keys. On startup we try to
// decrypt this first — if it fails, we know the crypto runtime changed
// (e.g. compiled binary ↔ bun source) and all stored keys are stale.
const CANARY_PLAINTEXT = "ax-code-canary-v1"

export interface EncryptedValue {
  encrypted: string // base64 ciphertext
  iv: string // base64 IV
  salt: string // base64 salt
  tag: string // base64 auth tag
  version: number
}

/**
 * Returns a per-install secret. On first call, generates a 32-byte random
 * hex string and persists it to disk. Subsequent calls read the stored value.
 * Falls back to empty string if the data directory is unavailable (e.g. during
 * tests), preserving backward compatibility with the hostname-only password.
 */
let installSecret: string | undefined
function getInstallSecret(): string {
  if (installSecret !== undefined) return installSecret
  try {
    const secretPath = path.join(Global.Path.data, ".install-secret")
    try {
      installSecret = readFileSync(secretPath, "utf-8").trim()
    } catch {
      // First run — generate and persist
      installSecret = randomBytes(32).toString("hex")
      mkdirSync(path.dirname(secretPath), { recursive: true })
      try {
        writeFileSync(secretPath, installSecret, { mode: 0o600, flag: "wx" })
        log.info("generated install secret for encryption key derivation")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          installSecret = readFileSync(secretPath, "utf-8").trim()
        } else {
          throw error
        }
      }
    }
  } catch (error) {
    // Data directory not available (e.g. unit tests) — fall back gracefully.
    // Log so production data-dir failures do not silently weaken key derivation.
    log.warn("install secret unavailable; using legacy machine id for encryption key derivation", {
      error,
    })
    installSecret = ""
  }
  return installSecret
}

/** Test-only: clear the cached install secret so getInstallSecret re-reads disk. */
export function __resetInstallSecretCacheForTests() {
  installSecret = undefined
}

/** Legacy machine ID (hostname-platform-arch only) — used as fallback for decryption. */
function legacyMachineId(): string {
  return `${os.hostname()}-${os.platform()}-${os.arch()}`
}

/** Machine ID with per-install secret for stronger key derivation. */
function machineId(): string {
  const secret = getInstallSecret()
  if (!secret) return legacyMachineId()
  return `${os.hostname()}-${os.platform()}-${os.arch()}-${secret}`
}

/**
 * The hostname feeding machineId() is not stable: on macOS the transient
 * (DHCP-assigned) hostname differs from the mDNS name (`LocalHostName.local`)
 * and changes when the machine moves networks. Credentials encrypted under a
 * previous hostname are unrecoverable unless decryption also tries the known
 * variants — the mDNS name with and without the ".local" suffix.
 */
let hostnameVariantsCache: string[] | undefined
function hostnameVariants(): string[] {
  if (hostnameVariantsCache) return hostnameVariantsCache
  const variants = new Set<string>()
  const add = (hostname: string) => {
    const base = hostname.endsWith(".local") ? hostname.slice(0, -".local".length) : hostname
    if (base) {
      variants.add(base)
      variants.add(`${base}.local`)
    }
  }
  add(os.hostname())
  if (os.platform() === "darwin") {
    try {
      add(
        execFileSync("scutil", ["--get", "LocalHostName"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      )
    } catch {
      // scutil unavailable — fall through with the current hostname only
    }
  }
  variants.delete(os.hostname())
  hostnameVariantsCache = [...variants]
  return hostnameVariantsCache
}

/**
 * All derivation passwords worth trying, most likely first: the current
 * machine ID (with install secret when present), then hostname variants.
 * Each hostname contributes a secret-backed and a legacy secret-less form.
 */
function candidatePasswords(): string[] {
  const secret = getInstallSecret()
  const passwords = new Set<string>()
  const add = (hostname: string) => {
    const base = `${hostname}-${os.platform()}-${os.arch()}`
    if (secret) passwords.add(`${base}-${secret}`)
    passwords.add(base)
  }
  add(os.hostname())
  for (const hostname of hostnameVariants()) add(hostname)
  return [...passwords]
}

// PBKDF2 is deterministic, so within one process the same
// (password, salt, iterations) triple always yields the same key. Auth.all()
// is called from several init paths (config load, provider state) and each
// call decrypts every stored field — without this cache every call re-paid
// the full derivation cost. Holding derived keys in memory is no more
// sensitive than the decrypted plaintexts already held by those callers.
const KEY_CACHE_LIMIT = 512
const keyCache = new Map<string, Buffer>()

function deriveKeyWithPassword(password: string, salt: Buffer, iterations: number): Buffer {
  const cacheKey = `${password}|${salt.toString("base64")}|${iterations}`
  const cached = keyCache.get(cacheKey)
  if (cached) return cached
  const key = NativePerf.run("auth.deriveKey", iterations, () =>
    pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha256"),
  )
  if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.clear()
  keyCache.set(cacheKey, key)
  return key
}

function deriveKey(salt: Buffer, iterations: number): Buffer {
  return deriveKeyWithPassword(machineId(), salt, iterations)
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 */
export function encrypt(plaintext: string): EncryptedValue {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  // Without an install secret the password degrades to hostname-platform-arch
  // (low entropy), so keep the full v1 stretching in that fallback case.
  const version = getInstallSecret() ? ENCRYPTION_VERSION : 1
  const key = deriveKey(salt, version >= 2 ? PBKDF2_ITERATIONS_V2 : PBKDF2_ITERATIONS)

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
    version,
  }
}

/**
 * Decrypt an encrypted value back to plaintext.
 * Tries the version-appropriate derivation for every known machine ID first
 * (the current one, then hostname variants — see hostnameVariants), then
 * falls back to legacy iteration counts for backward compat.
 *
 * Individual attempt failures are swallowed so old ciphertexts (legacy
 * iteration counts, previous hostnames) upgrade silently. They are logged at
 * debug level so genuine corruption is still traceable via logs — previously
 * the failure was completely invisible.
 */
export function decrypt(value: EncryptedValue): string {
  return decryptDetailed(value).plaintext
}

/**
 * Like decrypt(), but also reports whether a non-primary derivation was
 * needed so callers can flag the entry for re-encryption under the current
 * machine ID.
 */
function decryptDetailed(value: EncryptedValue): { plaintext: string; usedFallbackDerivation: boolean } {
  const encrypted = decodeBase64Field(value.encrypted, "encrypted")
  const iv = decodeBase64Field(value.iv, "iv", IV_LENGTH)
  const tag = decodeBase64Field(value.tag, "tag", AUTH_TAG_LENGTH)
  // Legacy entries lack an explicit salt field. For those, the IV was
  // used as the salt during encryption. iv.subarray(0, SALT_LENGTH)
  // returns only 16 bytes (IV_LENGTH) instead of the full 32-byte
  // SALT_LENGTH — this is a known limitation preserved for backward
  // compatibility. Callers should re-encrypt via encrypt() to migrate
  // legacy entries to a proper 32-byte random salt.
  const salt = value.salt ? decodeBase64Field(value.salt, "salt", SALT_LENGTH) : iv.subarray(0, SALT_LENGTH)

  const passwords = candidatePasswords()
  const primaryIterations = value.version >= 2 ? PBKDF2_ITERATIONS_V2 : PBKDF2_ITERATIONS

  // Pass 1: the derivation a current build would have used, across every
  // known machine ID. This recovers entries written under a previous
  // hostname without paying for legacy-iteration attempts on the hot path.
  for (const [index, password] of passwords.entries()) {
    try {
      return {
        plaintext: decryptWithPassword(password, encrypted, iv, salt, tag, primaryIterations),
        usedFallbackDerivation: index !== 0,
      }
    } catch {
      log.debug(`key derivation attempt failed (machine id #${index}, current iterations)`)
    }
  }

  // Pass 2: legacy iteration counts (pre-v2 builds and ax-cli imports).
  for (const password of passwords) {
    for (const iterations of [PBKDF2_ITERATIONS, PBKDF2_LEGACY_ITERATIONS]) {
      if (iterations === primaryIterations) continue
      try {
        return {
          plaintext: decryptWithPassword(password, encrypted, iv, salt, tag, iterations),
          usedFallbackDerivation: true,
        }
      } catch {
        log.debug("key derivation attempt failed (legacy iterations)")
      }
    }
  }

  throw new Error("decryption failed — all key derivation attempts exhausted")
}

function decodeBase64Field(value: string, field: string, expectedLength?: number): Buffer {
  const normalized = value.replace(/\s+/g, "")
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error(`invalid encrypted auth field: ${field}`)
  }
  const decoded = Buffer.from(normalized, "base64")
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`invalid encrypted auth field length: ${field}`)
  }
  return decoded
}

function decryptWithPassword(
  password: string,
  encrypted: Buffer,
  iv: Buffer,
  salt: Buffer,
  tag: Buffer,
  iterations: number,
): string {
  const key = deriveKeyWithPassword(password, salt, iterations)
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
    const { plaintext, usedFallbackDerivation } = decryptDetailed(val)
    // Re-encrypt when the entry uses the legacy IV-as-salt derivation, when a
    // fallback machine ID (e.g. a previous hostname) was needed to decrypt,
    // or when it predates the current version and encrypt() would actually
    // upgrade it (it only writes v2 when the install secret exists —
    // without that guard, secret-less environments would re-mark v1
    // entries on every start and rewrite the file for nothing).
    if (
      isLegacySalt(val) ||
      usedFallbackDerivation ||
      (val.version < ENCRYPTION_VERSION && getInstallSecret() !== "")
    ) {
      return { ...obj, [field]: plaintext, __needsReEncrypt: true }
    }
    return { ...obj, [field]: plaintext }
  } catch (err) {
    log.warn(`failed to decrypt field "${field}" — credential may need to be re-entered`, {
      err: toErrorMessage(err),
    })
    return { ...obj, [field]: undefined }
  }
}

/**
 * Test encryption round-trip
 */
export function test(): boolean {
  try {
    const plain = TEST_KEY_VALUE
    const enc = encrypt(plain)
    return decrypt(enc) === plain
  } catch {
    return false
  }
}

/**
 * Create a canary ciphertext that can be stored alongside real keys.
 * If the canary decrypts successfully on startup, the crypto runtime
 * is compatible and all stored keys should be decryptable.
 */
export function createCanary(): EncryptedValue {
  return encrypt(CANARY_PLAINTEXT)
}

/**
 * Verify a stored canary. Returns true if the current crypto runtime
 * can decrypt keys that were encrypted when the canary was created.
 */
export function verifyCanary(canary: unknown): boolean {
  if (!isEncrypted(canary)) return false
  try {
    return decrypt(canary) === CANARY_PLAINTEXT
  } catch {
    return false
  }
}
