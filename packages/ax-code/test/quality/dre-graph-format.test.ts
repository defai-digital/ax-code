import { describe, expect, test } from "vitest"
import {
  agentDisplay,
  confidenceTone,
  esc,
  json,
  num,
  readiness,
  readinessTone,
  stamp,
  time,
  tone,
  validation,
} from "../../src/quality/dre-graph-format"

describe("quality.dre-graph-format", () => {
  test("escapes HTML and script-sensitive JSON", () => {
    expect(esc(`<tag attr="x&y">'`)).toBe("&lt;tag attr=&quot;x&amp;y&quot;&gt;&#39;")
    expect(json({ text: "<script>&\u2028\u2029" })).toBe('{"text":"\\u003cscript\\u003e\\u0026\\u2028\\u2029"}')
  })

  test("formats labels, numbers, durations, and timestamps", () => {
    expect(agentDisplay("debug")).toBe("Debugger")
    expect(agentDisplay("custom")).toBe("Custom")
    expect(num(1234567)).toBe("1,234,567")
    expect(time(undefined)).toBe("0s")
    expect(time(59_900)).toBe("59s")
    expect(time(125_000)).toBe("2m 5s")
    expect(stamp(undefined)).toBe("unknown")
    expect(stamp(Number.NaN)).toBe("unknown")
    expect(stamp(Number.POSITIVE_INFINITY)).toBe("unknown")
    expect(stamp(8_640_000_000_000_001)).toBe("unknown")
    expect(stamp(Date.UTC(2026, 4, 17, 12, 34, 56))).toBe("2026-05-17 12:34:56")
  })

  test("classifies risk, confidence, readiness, and validation state", () => {
    expect(tone("critical issue")).toBe("critical")
    expect(tone("HIGH")).toBe("high")
    expect(tone("medium")).toBe("medium")
    expect(tone("unknown")).toBe("low")
    expect(confidenceTone(0.8)).toBe("low")
    expect(confidenceTone(0.6)).toBe("medium")
    expect(confidenceTone(0.59)).toBe("high")
    expect(readinessTone("ready")).toBe("low")
    expect(readinessTone("needs_validation")).toBe("medium")
    expect(readinessTone("needs_review")).toBe("high")
    expect(readinessTone("blocked")).toBe("critical")
    expect(readiness("needs_validation")).toBe("needs validation")
    expect(validation({ validationState: "passed" } as any)).toBe("validation passed")
    expect(validation({ validationState: "failed" } as any)).toBe("validation failed")
    expect(validation({ validationState: "partial" } as any)).toBe("partial validation")
    expect(validation({ validationState: "not_run" } as any)).toBe("validation not recorded")
  })
})
