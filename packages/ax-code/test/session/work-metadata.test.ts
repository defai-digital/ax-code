import { describe, expect, test } from "vitest"
import { SessionMetadata } from "../../src/session/metadata"

describe("SessionMetadata.work", () => {
  test("accepts a Work namespace", () => {
    const metadata = SessionMetadata.validate({
      work: { version: 1, computer: true, providerID: "openai", modelID: "gpt-5.6-sol" },
    })
    expect(SessionMetadata.product(metadata).work).toEqual({
      version: 1,
      computer: true,
      providerID: "openai",
      modelID: "gpt-5.6-sol",
    })
  })

  test("rejects unknown work fields", () => {
    expect(() =>
      SessionMetadata.validate({
        work: { version: 1, computer: true, extra: true },
      }),
    ).toThrow()
  })
})
