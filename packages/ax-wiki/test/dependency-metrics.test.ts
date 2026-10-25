import { expect, test } from "vitest"
import { dependencyMetrics } from "../src/dependency-metrics.js"

test("separates directed neighbor counts from file-pair weights and keeps isolates", () => {
  const metrics = dependencyMetrics(
    ["app", "lib", "util", "isolated"],
    [
      { from: "app", to: "lib", imports: 8 },
      { from: "app", to: "util", imports: 2 },
      { from: "util", to: "lib", imports: 1 },
      { from: "lib", to: "app", imports: 3 },
      { from: "app", to: "app", imports: 99 },
      { from: "outside", to: "lib", imports: 99 },
    ],
  )
  expect(metrics.get("app")).toEqual({ inboundNeighbors: 1, outboundNeighbors: 2, inboundPairs: 3, outboundPairs: 10 })
  expect(metrics.get("lib")).toEqual({ inboundNeighbors: 2, outboundNeighbors: 1, inboundPairs: 9, outboundPairs: 3 })
  expect(metrics.get("isolated")).toEqual({
    inboundNeighbors: 0,
    outboundNeighbors: 0,
    inboundPairs: 0,
    outboundPairs: 0,
  })
})

test("rejects invalid or overflowing weights", () => {
  for (const imports of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => dependencyMetrics(["a", "b"], [{ from: "a", to: "b", imports }])).toThrow()
  expect(() =>
    dependencyMetrics(
      ["a", "b", "c"],
      [
        { from: "a", to: "b", imports: Number.MAX_SAFE_INTEGER },
        { from: "a", to: "c", imports: 1 },
      ],
    ),
  ).toThrow()
})
