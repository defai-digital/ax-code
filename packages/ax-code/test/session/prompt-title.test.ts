import { describe, expect, test } from "vitest"

import { AX_ENGINE_PROVIDER_ID } from "../../src/provider/ax-engine"
import { ProviderID } from "../../src/provider/schema"
import { shouldSkipAutomaticTitle } from "../../src/session/prompt-title"

describe("session prompt title", () => {
  test("skips automatic title generation for the managed ax-engine provider", () => {
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID) })).toBe(true)
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.xai })).toBe(false)
  })
})
