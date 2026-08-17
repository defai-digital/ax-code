import path from "path"
import os from "os"
import { expect, test } from "vitest"
import { createCipheriv, pbkdf2Sync, randomBytes } from "crypto"
import { readFileSync } from "fs"
import { decrypt, decryptField, encrypt, isEncrypted, type EncryptedValue } from "../../src/auth/encryption"
import { Global } from "../../src/global"

// Mirrors the constants in src/auth/encryption.ts for constructing
// legacy v1 ciphertexts the way an older build would have written them.
const KEY_LENGTH = 32
const IV_LENGTH = 16
const SALT_LENGTH = 32
const AUTH_TAG_LENGTH = 16
const PBKDF2_ITERATIONS_V1 = 600_000

function machineId() {
  const secretPath = path.join(Global.Path.data, ".install-secret")
  try {
    readFileSync(secretPath, "utf-8")
  } catch {
    // First call in this test home — let the module generate and persist it.
    encrypt("seed-install-secret")
  }
  const secret = readFileSync(secretPath, "utf-8").trim()
  return `${os.hostname()}-${os.platform()}-${os.arch()}-${secret}`
}

function encryptV1(plaintext: string): EncryptedValue {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = pbkdf2Sync(machineId(), salt, PBKDF2_ITERATIONS_V1, KEY_LENGTH, "sha256")
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  }
}

test("encrypt writes version 2 when an install secret exists and round-trips", () => {
  const value = encrypt("super-secret-key")
  expect(value.version).toBe(2)
  expect(decrypt(value)).toBe("super-secret-key")
})

test("decrypt still reads v1 entries written with full-iteration PBKDF2", () => {
  const v1 = encryptV1("legacy-key")
  expect(decrypt(v1)).toBe("legacy-key")
})

test("decrypt rejects malformed encrypted auth fields", () => {
  const value = encrypt("super-secret-key")
  expect(() => decrypt({ ...value, iv: "not base64!!" })).toThrow("invalid encrypted auth field: iv")
})

test("decrypt rejects encrypted auth fields with invalid fixed lengths", () => {
  const value = encrypt("super-secret-key")
  const short = Buffer.from("short").toString("base64")
  expect(() => decrypt({ ...value, tag: short })).toThrow("invalid encrypted auth field length: tag")
  expect(() => decrypt({ ...value, salt: short })).toThrow("invalid encrypted auth field length: salt")
})

test("decryptField marks v1 entries for re-encryption", () => {
  const obj = { type: "api", key: encryptV1("legacy-key") } as Record<string, unknown>
  const result = decryptField(obj, "key")
  expect(result.key).toBe("legacy-key")
  expect(result.__needsReEncrypt).toBe(true)
})

test("decryptField does not re-mark v2 entries", () => {
  const obj = { type: "api", key: encrypt("fresh-key") } as Record<string, unknown>
  const result = decryptField(obj, "key")
  expect(result.key).toBe("fresh-key")
  expect("__needsReEncrypt" in result).toBe(false)
})

test("isEncrypted accepts both versions", () => {
  expect(isEncrypted(encrypt("a"))).toBe(true)
  expect(isEncrypted(encryptV1("a"))).toBe(true)
})

test("decrypt recovers v2 entries written under a previous hostname", () => {
  // macOS toggles between the mDNS name ("host.local") and transient
  // DHCP-assigned hostnames; entries written under the other form must
  // still decrypt and be flagged for re-encryption under the current one.
  const current = os.hostname()
  const previous = current.endsWith(".local") ? current.slice(0, -".local".length) : `${current}.local`
  machineId() // ensure the install secret exists, then read it
  const secret = readFileSync(path.join(Global.Path.data, ".install-secret"), "utf-8").trim()

  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = pbkdf2Sync(`${previous}-${os.platform()}-${os.arch()}-${secret}`, salt, 10_000, KEY_LENGTH, "sha256")
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update("previous-hostname-key", "utf8"), cipher.final()])
  const value: EncryptedValue = {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 2,
  }

  expect(decrypt(value)).toBe("previous-hostname-key")
  const result = decryptField({ type: "api", key: value } as Record<string, unknown>, "key")
  expect(result.key).toBe("previous-hostname-key")
  expect(result.__needsReEncrypt).toBe(true)
})

test("logs a warning and falls back to legacy machine id when install secret is unavailable", async () => {
  const { __resetInstallSecretCacheForTests, encrypt: encryptAgain } = await import("../../src/auth/encryption")
  const { Log } = await import("../../src/util/log")

  // Same service key as encryption.ts — Log.create caches by service tag.
  const logger = Log.create({ service: "auth/encryption" })
  const warnings: Array<{ message: unknown; extra?: Record<string, unknown> }> = []
  const originalWarn = logger.warn
  logger.warn = (message?: unknown, extra?: Record<string, unknown>) => {
    warnings.push({ message, extra })
    originalWarn(message, extra)
  }

  __resetInstallSecretCacheForTests()

  // Point data dir at a path that cannot hold a secret file (file, not directory).
  const originalData = Global.Path.data
  const blocker = path.join(os.tmpdir(), `ax-enc-blocker-${process.pid}-${Date.now()}`)
  const fs = await import("fs")
  fs.writeFileSync(blocker, "not-a-directory")

  try {
    Global.Path.data = blocker
    __resetInstallSecretCacheForTests()
    const value = encryptAgain("fallback-key")
    // Without install secret, encrypt uses version 1 (legacy derivation).
    expect(value.version).toBe(1)
    expect(decrypt(value)).toBe("fallback-key")
    expect(warnings.length).toBeGreaterThan(0)
    expect(String(warnings[0]?.message ?? "")).toMatch(/install secret unavailable/i)
  } finally {
    logger.warn = originalWarn
    Global.Path.data = originalData
    __resetInstallSecretCacheForTests()
    try {
      fs.unlinkSync(blocker)
    } catch {
      // ignore cleanup
    }
  }
})
