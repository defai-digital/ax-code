import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { createRuntimeAuthPasswordProvider, generateRuntimeAuthPassword, getRuntimeAuthPassword } = require(
  "./runtime-auth-password.js",
)

const BASE64URL_UNPADDED_RE = /^[A-Za-z0-9_-]{43}$/

describe("generateRuntimeAuthPassword", () => {
  test("matches the web server generator format (32 bytes, unpadded base64url)", () => {
    // 32 zero bytes -> base64 "AAAA...AA==" -> base64url without padding.
    const password = generateRuntimeAuthPassword(() => Buffer.alloc(32))

    expect(password).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    expect(password).toMatch(BASE64URL_UNPADDED_RE)
  })

  test("produces url-safe output without padding for bytes that map to +/=", () => {
    // 0xfb 0xff 0xfe encodes as "+/+" in base64; padding is appended for the
    // final partial group. Both must be normalized away.
    const password = generateRuntimeAuthPassword(() => Buffer.alloc(32, 0xff))

    expect(password).toMatch(BASE64URL_UNPADDED_RE)
    expect(password).not.toContain("+")
    expect(password).not.toContain("/")
    expect(password).not.toContain("=")
  })

  test("generates distinct passwords across generations (256-bit entropy source)", () => {
    const first = generateRuntimeAuthPassword()
    const second = generateRuntimeAuthPassword()

    expect(first).toMatch(BASE64URL_UNPADDED_RE)
    expect(second).toMatch(BASE64URL_UNPADDED_RE)
    expect(first).not.toBe(second)
  })
})

describe("createRuntimeAuthPasswordProvider", () => {
  test("memoizes one password per provider", () => {
    let calls = 0
    const provider = createRuntimeAuthPasswordProvider({
      env: {},
      randomBytes: (size) => {
        calls += 1
        return Buffer.alloc(size, calls)
      },
    })

    const first = provider.getPassword()
    const second = provider.getPassword()

    expect(first).toBe(second)
    expect(calls).toBe(1)
  })

  test("adopts an inherited AX_CODE_SERVER_PASSWORD instead of generating", () => {
    const provider = createRuntimeAuthPasswordProvider({
      env: { AX_CODE_SERVER_PASSWORD: " user-exported-secret " },
      randomBytes: () => {
        throw new Error("must not generate when env provides a password")
      },
    })

    expect(provider.getPassword()).toBe("user-exported-secret")
  })

  test("ignores a blank inherited password and generates instead", () => {
    const provider = createRuntimeAuthPasswordProvider({
      env: { AX_CODE_SERVER_PASSWORD: "   " },
      randomBytes: (size) => Buffer.alloc(size, 7),
    })

    expect(provider.getPassword()).toMatch(BASE64URL_UNPADDED_RE)
  })

  test("providers are isolated from each other", () => {
    const a = createRuntimeAuthPasswordProvider({ env: {} })
    const b = createRuntimeAuthPasswordProvider({ env: {} })

    expect(a.getPassword()).not.toBe(b.getPassword())
  })
})

describe("getRuntimeAuthPassword (process-wide provider)", () => {
  test("memoizes across calls", () => {
    expect(getRuntimeAuthPassword()).toBe(getRuntimeAuthPassword())
  })
})
