import path from "path"
import os from "os"
import { expect, test } from "bun:test"
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
