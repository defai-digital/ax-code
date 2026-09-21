import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  AX_ENGINE_CONTEXT_TOKENS_ENV,
  AX_ENGINE_OUTPUT_TOKENS_ENV,
  resolveAxEngineContextTokens,
  resolveAxEngineOutputTokens,
} from "../../../src/provider/ax-engine/constants"

// Catalog ceilings as declared in provider/ax-engine/constants.ts.
const CONTEXT_CEILING = 65_536
const OUTPUT_CEILING = 8_192

afterEach(() => {
  delete process.env[AX_ENGINE_CONTEXT_TOKENS_ENV]
  delete process.env[AX_ENGINE_OUTPUT_TOKENS_ENV]
})

describe("resolveAxEngineContextTokens", () => {
  beforeEach(() => {
    delete process.env[AX_ENGINE_CONTEXT_TOKENS_ENV]
  })

  test("falls back to the catalog ceiling", () => {
    expect(resolveAxEngineContextTokens({}, CONTEXT_CEILING)).toBe(CONTEXT_CEILING)
  })

  test("narrows the paged KV budget when configured", () => {
    expect(resolveAxEngineContextTokens({ contextTokens: 16_384 }, CONTEXT_CEILING)).toBe(16_384)
  })

  test("accepts numeric strings", () => {
    expect(resolveAxEngineContextTokens({ contextTokens: "16384" }, CONTEXT_CEILING)).toBe(16_384)
  })

  test("clamps a value above the catalog ceiling instead of widening it", () => {
    expect(resolveAxEngineContextTokens({ contextTokens: 131_072 }, CONTEXT_CEILING)).toBe(CONTEXT_CEILING)
  })

  test("ignores invalid values", () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, "abc", "", "  ", null, undefined, {}, []]) {
      expect(resolveAxEngineContextTokens({ contextTokens: invalid }, CONTEXT_CEILING)).toBe(CONTEXT_CEILING)
    }
  })

  test("reads the env override, and a configured option outranks it", () => {
    process.env[AX_ENGINE_CONTEXT_TOKENS_ENV] = "32768"
    expect(resolveAxEngineContextTokens({}, CONTEXT_CEILING)).toBe(32_768)
    expect(resolveAxEngineContextTokens({ contextTokens: 16_384 }, CONTEXT_CEILING)).toBe(16_384)
  })

  test("ignores an invalid env override", () => {
    process.env[AX_ENGINE_CONTEXT_TOKENS_ENV] = "not-a-number"
    expect(resolveAxEngineContextTokens({}, CONTEXT_CEILING)).toBe(CONTEXT_CEILING)
  })
})

describe("resolveAxEngineOutputTokens", () => {
  beforeEach(() => {
    delete process.env[AX_ENGINE_OUTPUT_TOKENS_ENV]
  })

  test("falls back to the catalog ceiling", () => {
    expect(resolveAxEngineOutputTokens({}, OUTPUT_CEILING)).toBe(OUTPUT_CEILING)
  })

  test("narrows the per-request output budget when configured", () => {
    expect(resolveAxEngineOutputTokens({ outputTokens: 2_048 }, OUTPUT_CEILING)).toBe(2_048)
  })

  test("clamps a value above the catalog ceiling", () => {
    expect(resolveAxEngineOutputTokens({ outputTokens: 32_000 }, OUTPUT_CEILING)).toBe(OUTPUT_CEILING)
  })

  test("reads the env override, and a configured option outranks it", () => {
    process.env[AX_ENGINE_OUTPUT_TOKENS_ENV] = "2048"
    expect(resolveAxEngineOutputTokens({}, OUTPUT_CEILING)).toBe(2_048)
    expect(resolveAxEngineOutputTokens({ outputTokens: 1_024 }, OUTPUT_CEILING)).toBe(1_024)
  })
})
