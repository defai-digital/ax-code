import { describe, expect, test } from "bun:test"
import { parseHeadlessRuntimeJsonBody, parseHeadlessRuntimeResponseBody } from "../../../src/runtime/headless"

describe("headless runtime", () => {
  test("parseHeadlessRuntimeResponseBody decodes JSON bodies", () => {
    expect(parseHeadlessRuntimeResponseBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })

  test("parseHeadlessRuntimeJsonBody decodes non-empty JSON bodies", () => {
    expect(parseHeadlessRuntimeJsonBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })

  test("parseHeadlessRuntimeResponseBody treats empty bodies as accepted", () => {
    expect(parseHeadlessRuntimeResponseBody("")).toBe(true)
  })

  test("parseHeadlessRuntimeResponseBody reports invalid JSON with a bounded preview", () => {
    expect(() => parseHeadlessRuntimeResponseBody("{not json")).toThrow("Headless runtime returned invalid JSON")
    expect(() => parseHeadlessRuntimeJsonBody("{not json")).toThrow("Headless runtime returned invalid JSON")
  })
})
