import { describe, expect, test } from "bun:test"
import { parseEncryptedToken } from "../../src/account/repo"
import { encrypt } from "../../src/auth/encryption"

describe("account token decoding", () => {
  test("recognizes encrypted token JSON", () => {
    const encrypted = encrypt("secret-token")
    expect(parseEncryptedToken(JSON.stringify(encrypted))).toEqual(encrypted)
  })

  test("treats plaintext and malformed JSON as unencrypted", () => {
    expect(parseEncryptedToken("plain-token")).toBeUndefined()
    expect(parseEncryptedToken("{not json")).toBeUndefined()
    expect(parseEncryptedToken(JSON.stringify({ encrypted: "missing fields" }))).toBeUndefined()
    expect(parseEncryptedToken(JSON.stringify(["not", "an", "encrypted", "token"]))).toBeUndefined()
  })
})
