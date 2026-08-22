import { createHash } from "crypto"
import { describe, expect, test } from "vitest"
import {
  classifyEnvelopeFreshness,
  enforceCitationFreshness,
  SourceStateSchema,
  type EnvelopeFreshness,
  type SourceState,
} from "../src/quality/freshness"
import {
  computeEnvelopeId,
  VerificationEnvelopeSchema,
  type VerificationEnvelope,
} from "../src/quality/verification-envelope"
import { makeEnvelope } from "./fixture/envelope"

const available: SourceState = {
  available: true,
  commit: "0123456789abcdef0123456789abcdef01234567",
  dirtyDigest: "deadbeef",
}

function withSourceState(sourceState: SourceState | undefined): Pick<VerificationEnvelope, "sourceState"> {
  return { sourceState }
}

describe("classifyEnvelopeFreshness", () => {
  test("no sourceState on the envelope → unknown/no-source-state", () => {
    expect(classifyEnvelopeFreshness(withSourceState(undefined), available)).toEqual({
      status: "unknown",
      reason: "no-source-state",
    })
  })

  test("envelope sourceState unavailable → unknown/source-unavailable", () => {
    expect(
      classifyEnvelopeFreshness(withSourceState({ available: false, commit: null, dirtyDigest: null }), available),
    ).toEqual({ status: "unknown", reason: "source-unavailable" })
  })

  test("current source unavailable → unknown/source-unavailable", () => {
    expect(
      classifyEnvelopeFreshness(withSourceState(available), { available: false, commit: null, dirtyDigest: null }),
    ).toEqual({ status: "unknown", reason: "source-unavailable" })
  })

  test("both sides unavailable → unknown/source-unavailable", () => {
    const unavailable = { available: false, commit: null, dirtyDigest: null }
    expect(classifyEnvelopeFreshness(withSourceState(unavailable), unavailable)).toEqual({
      status: "unknown",
      reason: "source-unavailable",
    })
  })

  test("commit mismatch → stale/commit-moved", () => {
    expect(
      classifyEnvelopeFreshness(withSourceState(available), {
        ...available,
        commit: "ffffffffffffffffffffffffffffffffffffffff",
      }),
    ).toEqual({ status: "stale", reason: "commit-moved" })
  })

  test("dirtyDigest mismatch → stale/dirty-changed", () => {
    expect(classifyEnvelopeFreshness(withSourceState(available), { ...available, dirtyDigest: "cafef00d" })).toEqual({
      status: "stale",
      reason: "dirty-changed",
    })
  })

  test("commit mismatch wins over dirtyDigest mismatch", () => {
    expect(
      classifyEnvelopeFreshness(withSourceState(available), {
        available: true,
        commit: null,
        dirtyDigest: "different",
      }),
    ).toEqual({ status: "stale", reason: "commit-moved" })
  })

  test("identical commit and dirtyDigest → fresh", () => {
    expect(classifyEnvelopeFreshness(withSourceState(available), { ...available })).toEqual({ status: "fresh" })
  })

  test("null commit on both sides compares equal (fresh when digests match)", () => {
    const noCommit: SourceState = { available: true, commit: null, dirtyDigest: "abc" }
    expect(classifyEnvelopeFreshness(withSourceState(noCommit), { ...noCommit })).toEqual({ status: "fresh" })
  })

  test("accepts a full envelope (not just the sourceState slice)", () => {
    const envelope = makeEnvelope()
    expect(classifyEnvelopeFreshness(envelope, available)).toEqual({
      status: "unknown",
      reason: "no-source-state",
    })
    expect(classifyEnvelopeFreshness({ ...envelope, sourceState: available }, { ...available })).toEqual({
      status: "fresh",
    })
  })
})

describe("enforceCitationFreshness", () => {
  const fresh: EnvelopeFreshness = { status: "fresh" }
  const stale: EnvelopeFreshness = { status: "stale", reason: "commit-moved" }
  const unknown: EnvelopeFreshness = { status: "unknown", reason: "no-source-state" }

  test("authoritative + fresh → ok", () => {
    expect(enforceCitationFreshness(fresh, "authoritative")).toEqual({ ok: true, needsVerification: false })
  })

  test("authoritative + stale → needs verification", () => {
    expect(enforceCitationFreshness(stale, "authoritative")).toEqual({ ok: false, needsVerification: true })
  })

  test("authoritative + unknown → needs verification", () => {
    expect(enforceCitationFreshness(unknown, "authoritative")).toEqual({ ok: false, needsVerification: true })
  })

  test("provenance is never blocked", () => {
    for (const freshness of [fresh, stale, unknown]) {
      expect(enforceCitationFreshness(freshness, "provenance")).toEqual({ ok: true, needsVerification: false })
    }
  })
})

describe("computeEnvelopeId — v1 identity regression lock", () => {
  // The pre-Phase-1 implementation hashed the canonicalized WHOLE envelope
  // object. Reimplemented inline here so the test pins the legacy algorithm
  // even if the production helper drifts.
  function legacyCanonicalJSON(value: unknown): string {
    if (value === undefined) return "null"
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
      return "[" + value.map(legacyCanonicalJSON).join(",") + "]"
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + legacyCanonicalJSON(v)).join(",") + "}"
  }

  function legacyWholeObjectId(envelope: VerificationEnvelope): string {
    return createHash("sha256").update(legacyCanonicalJSON(envelope)).digest("hex").slice(0, 16)
  }

  test("v1 envelopes keep bit-identical ids under the identity projection", () => {
    const envelope = VerificationEnvelopeSchema.parse(makeEnvelope())
    expect(computeEnvelopeId(envelope)).toBe(legacyWholeObjectId(envelope))
  })

  test("provenance fields never affect the id", () => {
    const base = makeEnvelope()
    const enriched: VerificationEnvelope = {
      ...base,
      sourceState: available,
      graph: { revision: null, lastCommitSha: available.commit, indexedAt: 1755900000000 },
      environment: { configDigest: "abc", toolVersions: { "ax-code": "7.7.8" } },
      execution: {
        startedAt: "2026-08-22T10:00:00.000Z",
        endedAt: "2026-08-22T10:00:01.000Z",
        exitCode: 0,
        signal: null,
        timedOut: false,
        outputHashes: { stdout: "aaa", stderr: "bbb" },
        outputTruncated: false,
      },
    }
    expect(computeEnvelopeId(enriched)).toBe(computeEnvelopeId(base))
    expect(computeEnvelopeId(enriched)).toBe(legacyWholeObjectId(base))
  })
})

describe("VerificationEnvelopeSchema optional-field tolerance", () => {
  test("v1 envelope without provenance fields still parses", () => {
    const parsed = VerificationEnvelopeSchema.safeParse(makeEnvelope())
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.sourceState).toBeUndefined()
      expect(parsed.data.graph).toBeUndefined()
      expect(parsed.data.environment).toBeUndefined()
      expect(parsed.data.execution).toBeUndefined()
    }
  })

  test("envelope with all provenance fields parses", () => {
    const parsed = VerificationEnvelopeSchema.safeParse({
      ...makeEnvelope(),
      sourceState: available,
      graph: { revision: "rev", lastCommitSha: null, indexedAt: 1 },
      environment: {
        configDigest: "abc",
        toolVersions: { "ax-code": "7.7.8" },
        commandSelectionRationale: "inferred from package.json scripts",
      },
      execution: {
        startedAt: "2026-08-22T10:00:00.000Z",
        endedAt: "2026-08-22T10:00:01.000Z",
        exitCode: null,
        signal: "SIGTERM",
        timedOut: true,
        outputTruncated: true,
      },
    })
    expect(parsed.success).toBe(true)
  })

  test("the additive 'unavailable' status parses", () => {
    const parsed = VerificationEnvelopeSchema.safeParse(makeEnvelope({ status: "unavailable", passed: false }))
    expect(parsed.success).toBe(true)
  })

  test("malformed provenance fields are rejected", () => {
    expect(
      VerificationEnvelopeSchema.safeParse({
        ...makeEnvelope(),
        sourceState: { available: "yes", commit: null, dirtyDigest: null },
      }).success,
    ).toBe(false)
    expect(
      VerificationEnvelopeSchema.safeParse({
        ...makeEnvelope(),
        graph: { revision: null, lastCommitSha: null },
      }).success,
    ).toBe(false)
  })
})

describe("SourceStateSchema", () => {
  test("is the same schema the envelope uses (single definition)", () => {
    expect(SourceStateSchema.safeParse(available).success).toBe(true)
    expect(SourceStateSchema.safeParse({ available: false, commit: null, dirtyDigest: null }).success).toBe(true)
    expect(SourceStateSchema.safeParse({ available: true }).success).toBe(false)
  })
})
