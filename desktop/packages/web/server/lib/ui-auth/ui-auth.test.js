import { describe, expect, it } from "vitest"

import { derivePasswordBinding } from "./ui-auth.js"

describe("ui auth", () => {
  it("derives a stable passkey password binding with scrypt", () => {
    const first = derivePasswordBinding("correct horse battery staple", "jwt-secret")
    const second = derivePasswordBinding("correct horse battery staple", "jwt-secret")
    const rotated = derivePasswordBinding("correct horse battery staple", "rotated-secret")

    expect(first).toBe(second)
    expect(first).not.toBe(rotated)
    expect(first).toMatch(/^[a-f0-9]{128}$/)
  })
})
