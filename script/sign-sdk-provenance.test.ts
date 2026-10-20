import { beforeEach, describe, expect, test, vi } from "vitest"

const { create, verify, builderOptions, signerOptions, witnessOptions } = vi.hoisted(() => ({
  create: vi.fn(),
  verify: vi.fn(),
  builderOptions: vi.fn(),
  signerOptions: vi.fn(),
  witnessOptions: vi.fn(),
}))
vi.mock("sigstore", () => ({ verify }))
vi.mock("@sigstore/bundle", () => ({ bundleToJSON: (bundle: unknown) => bundle }))
vi.mock("@sigstore/sign", () => ({
  DSSEBundleBuilder: class {
    constructor(options: unknown) {
      builderOptions(options)
    }
    create = create
  },
  FulcioSigner: class {
    constructor(options: unknown) {
      signerOptions(options)
    }
  },
  RekorWitness: class {
    constructor(options: unknown) {
      witnessOptions(options)
    }
  },
}))
import { signSdkProvenance, signingPolicy } from "../.github/scripts/sign-sdk-provenance.mjs"

const workflowRef = "defai-digital/ax-code/.github/workflows/sdk-github-packages.yml@refs/tags/sdk-v2.6.7"
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
    create.mockResolvedValue({ dsseEnvelope: {} })
  })

  test.each([409, 403])("propagates unrecoverable log failures without signing again (%s)", async (statusCode) => {
    const failure = Object.assign(new Error("log rejected"), {
      code: "TLOG_CREATE_ENTRY_ERROR",
      cause: { statusCode },
    })
    create.mockRejectedValue(failure)
    await expect(signSdkProvenance(input)).rejects.toBe(failure)
    expect(create).toHaveBeenCalledTimes(1)
    expect(verify).not.toHaveBeenCalled()
  })

  test("verifies a logged SDK signature against the exact workflow identity", async () => {
    const bundle = { dsseEnvelope: {} }
    create.mockResolvedValue(bundle)
    verify.mockResolvedValue({})
    expect(await signSdkProvenance(input)).toBe(bundle)
    const [{ data: bytes, type }] = create.mock.lastCall!
    const statement = await new Response(bytes).json()
    expect(statement.subject).toEqual([
      { name: "pkg:npm/%40defai-digital/ax-code-sdk@2.6.7", digest: { sha256: input.digest } },
    ])
    expect(statement.predicateType).toBe("https://slsa.dev/provenance/v1")
    expect(type).toBe("application/vnd.in-toto+json")
    expect(builderOptions.mock.lastCall![0].certificateChain).toBe(true)
    expect(await signerOptions.mock.lastCall![0].identityProvider.getToken()).toBe("fixture")
    expect(witnessOptions.mock.lastCall![0]).toMatchObject({ entryType: "intoto", fetchOnConflict: true })
    expect(verify).toHaveBeenLastCalledWith(bundle, signingPolicy(workflowRef))
    const identity = new RegExp(signingPolicy(workflowRef).certificateIdentityURI)
    expect(identity.test(`https://github.com/${workflowRef}`)).toBe(true)
    expect(identity.test(`https://github.com/${workflowRef}-other`)).toBe(false)
  })
  test("fails closed on signature verification and untrusted workflow identities", async () => {
    verify.mockRejectedValueOnce(new Error("identity mismatch"))
    await expect(signSdkProvenance(input)).rejects.toThrow("identity mismatch")
    for (const ref of [
      workflowRef.replace("defai-digital", "other"),
      workflowRef.replace("sdk-github-packages", "release"),
      workflowRef.replace("tags/sdk-v2.6.7", "heads/feature"),
    ]) {
      expect(() => signingPolicy(ref)).toThrow("Unexpected SDK signing workflow")
    }
    await expect(signSdkProvenance({ ...input, digest: "bad" })).rejects.toThrow()
  })
})
