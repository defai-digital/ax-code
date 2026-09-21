import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  AX_ENGINE_CONTEXT_TOKENS_ENV,
  AX_ENGINE_OUTPUT_TOKENS_ENV,
  resolveAxEngineServingLimits,
} from "../../../src/provider/ax-engine/constants"

// Catalog ceilings as declared in provider/ax-engine/constants.ts. No apiModelID,
// so these cases exercise narrowing only and do not snap onto the prefix grid.
const CONTEXT_CEILING = 65_536
const OUTPUT_CEILING = 8_192
const ceiling = { contextTokens: CONTEXT_CEILING, outputTokens: OUTPUT_CEILING }

afterEach(() => {
  delete process.env[AX_ENGINE_CONTEXT_TOKENS_ENV]
  delete process.env[AX_ENGINE_OUTPUT_TOKENS_ENV]
  delete process.env.AX_ENGINE_MAX_OUTPUT_TOKENS
})

describe("narrowed AX Engine context", () => {
  beforeEach(() => {
    delete process.env[AX_ENGINE_CONTEXT_TOKENS_ENV]
  })

  test("falls back to the catalog ceiling", () => {
    expect(resolveAxEngineServingLimits({}, ceiling).contextTokens).toBe(CONTEXT_CEILING)
  })

  test("narrows the paged KV budget when configured", () => {
    expect(resolveAxEngineServingLimits({ contextTokens: 16_384 }, ceiling).contextTokens).toBe(16_384)
  })

  test("accepts numeric strings", () => {
    expect(resolveAxEngineServingLimits({ contextTokens: "16384" }, ceiling).contextTokens).toBe(16_384)
  })

  test("clamps a value above the catalog ceiling instead of widening it", () => {
    expect(resolveAxEngineServingLimits({ contextTokens: 131_072 }, ceiling).contextTokens).toBe(CONTEXT_CEILING)
  })

  test("ignores invalid values", () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, "abc", "", "  ", null, undefined, {}, []]) {
      expect(resolveAxEngineServingLimits({ contextTokens: invalid }, ceiling).contextTokens).toBe(CONTEXT_CEILING)
    }
  })

  test("reads the env override, and a configured option outranks it", () => {
    process.env[AX_ENGINE_CONTEXT_TOKENS_ENV] = "32768"
    expect(resolveAxEngineServingLimits({}, ceiling).contextTokens).toBe(32_768)
    expect(resolveAxEngineServingLimits({ contextTokens: 16_384 }, ceiling).contextTokens).toBe(16_384)
  })

  test("ignores an invalid env override", () => {
    process.env[AX_ENGINE_CONTEXT_TOKENS_ENV] = "not-a-number"
    expect(resolveAxEngineServingLimits({}, ceiling).contextTokens).toBe(CONTEXT_CEILING)
  })
})

describe("narrowed AX Engine output", () => {
  beforeEach(() => {
    delete process.env[AX_ENGINE_OUTPUT_TOKENS_ENV]
    delete process.env.AX_ENGINE_MAX_OUTPUT_TOKENS
  })

  test("falls back to the catalog ceiling", () => {
    expect(resolveAxEngineServingLimits({}, ceiling).maxOutputTokens).toBe(OUTPUT_CEILING)
  })

  test("narrows the per-request output budget when configured", () => {
    expect(resolveAxEngineServingLimits({ outputTokens: 2_048 }, ceiling).maxOutputTokens).toBe(2_048)
  })

  test("clamps a value above the catalog ceiling", () => {
    expect(resolveAxEngineServingLimits({ outputTokens: 32_000 }, ceiling).maxOutputTokens).toBe(OUTPUT_CEILING)
  })

  test("reads the env override, and a configured option outranks it", () => {
    process.env[AX_ENGINE_OUTPUT_TOKENS_ENV] = "2048"
    expect(resolveAxEngineServingLimits({}, ceiling).maxOutputTokens).toBe(2_048)
    expect(resolveAxEngineServingLimits({ outputTokens: 1_024 }, ceiling).maxOutputTokens).toBe(1_024)
  })
})
