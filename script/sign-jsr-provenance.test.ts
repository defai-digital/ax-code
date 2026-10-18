import { beforeEach, describe, expect, test, vi } from "vitest"

const { attest, verify } = vi.hoisted(() => ({ attest: vi.fn(), verify: vi.fn() }))
vi.mock("sigstore", () => ({ attest, verify }))
vi.mock("../.github/scripts/jsr-provenance-recovery.mjs", async (original) => ({
  ...(await original<object>()),
  toJsrBundle: vi.fn(),
}))
import { signJsrProvenance, signingPolicy } from "../.github/scripts/sign-jsr-provenance.mjs"
import { toJsrBundle } from "../.github/scripts/jsr-provenance-recovery.mjs"

const workflowRef = "defai-digital/ax-code/.github/workflows/sdk-jsr.yml@refs/tags/sdk-v2.6.7"
const input = {
  version: "2.6.7",
  digest: "a".repeat(64),
  predicate: { buildDefinition: {} },
  workflowRef,
  identityToken: "fixture",
}

describe("free SDK provenance signing", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    attest.mockResolvedValue({ dsseEnvelope: {} })
  })

  test("signs a fresh bundle once when Rekor reports an already-created entry", async () => {
    const duplicate = Object.assign(new Error("duplicate entry"), {
      code: "TLOG_CREATE_ENTRY_ERROR",
      cause: { statusCode: 409 },
    })
    const bundle = { dsseEnvelope: {} }
    attest.mockRejectedValueOnce(duplicate).mockResolvedValueOnce(bundle)
    expect(await signJsrProvenance(input)).toBe(bundle)
    expect(attest).toHaveBeenCalledTimes(2)
    expect(verify).toHaveBeenCalledWith(bundle, undefined, signingPolicy(workflowRef))
    expect(toJsrBundle).toHaveBeenCalledWith(bundle, input.version, input.digest)
  })

  test.each([409, 403])("bounds duplicate recovery and never retries other errors (%s)", async (statusCode) => {
    const failure = Object.assign(new Error("log rejected"), {
      code: "TLOG_CREATE_ENTRY_ERROR",
      cause: { statusCode },
    })
    attest.mockRejectedValue(failure)
    await expect(signJsrProvenance(input)).rejects.toBe(failure)
    expect(attest).toHaveBeenCalledTimes(statusCode === 409 ? 2 : 1)
    expect(verify).not.toHaveBeenCalled()
  })

  test("verifies a logged JSR-compatible signature against the exact workflow identity", async () => {
    const bundle = { dsseEnvelope: {} }
    attest.mockResolvedValue(bundle)
    verify.mockResolvedValue({})
    expect(await signJsrProvenance(input)).toBe(bundle)
    const [bytes, type, options] = attest.mock.lastCall!
    const statement = await new Response(bytes).json()
    expect(statement.subject).toEqual([
      { name: "pkg:jsr/@defai-digital/ax-code-sdk@2.6.7", digest: { sha256: input.digest } },
    ])
    expect(statement.predicateType).toBe("https://slsa.dev/provenance/v1")
    expect(type).toBe("application/vnd.in-toto+json")
    expect(options).toEqual({ identityToken: "fixture", legacyCompatibility: true, tlogUpload: true })
    expect(verify).toHaveBeenLastCalledWith(bundle, undefined, signingPolicy(workflowRef))
    expect(toJsrBundle).toHaveBeenLastCalledWith(bundle, input.version, input.digest)
    const identity = new RegExp(signingPolicy(workflowRef).certificateIdentityURI)
    expect(identity.test(`https://github.com/${workflowRef}`)).toBe(true)
    expect(identity.test(`https://github.com/${workflowRef}-other`)).toBe(false)
  })
  test("fails closed on signature verification and untrusted workflow identities", async () => {
    verify.mockRejectedValueOnce(new Error("identity mismatch"))
    await expect(signJsrProvenance(input)).rejects.toThrow("identity mismatch")
    for (const ref of [
      workflowRef.replace("defai-digital", "other"),
      workflowRef.replace("sdk-jsr", "release"),
      workflowRef.replace("tags/sdk-v2.6.7", "heads/feature"),
    ]) {
      expect(() => signingPolicy(ref)).toThrow("Unexpected SDK signing workflow")
    }
    await expect(signJsrProvenance({ ...input, digest: "bad" })).rejects.toThrow()
  })
})
