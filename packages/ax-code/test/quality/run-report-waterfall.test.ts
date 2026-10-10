import { describe, expect, test } from "vitest"
import { buildWaterfall, traceSection, waterfallSvg } from "../../src/quality/run-report/run-report-waterfall"
import type { ExecutionGraph } from "../../src/graph"

type N = ExecutionGraph.Node
function graph(nodes: Partial<N>[]): ExecutionGraph.Graph {
  return {
    sessionID: "s",
    nodes: nodes.map((node, i) => ({
      id: `n${i}`,
      type: "tool_call",
      label: "x",
      timestamp: 1000 + i * 100,
      ...node,
    })) as N[],
    edges: [],
    metadata: {} as ExecutionGraph.Graph["metadata"],
  }
}

describe("quality.run-report-waterfall", () => {
  test("large recorded runs remain bounded without spreading every timestamp into a call", () => {
    const chart = buildWaterfall(graph(Array.from({ length: 150_000 }, (_, i) => ({ timestamp: i, duration: 1 }))))
    expect(chart.rows).toHaveLength(40)
    expect(chart.hidden).toBe(149_960)
    expect(chart.total).toBe(150_000)
    expect(waterfallSvg(chart)).not.toContain("NaN")
  })

  test("unusable durations do not poison the entire timeline", () => {
    const chart = buildWaterfall(graph([{ duration: Number.NaN }, { duration: Infinity }, { duration: -5 }]))
    expect(chart.rows.map((row) => row.duration)).toEqual([0, 0, 0])
    expect(Number.isFinite(chart.total)).toBe(true)
    expect(waterfallSvg(chart)).not.toContain("NaN")
  })

  test("bar positions use the same time scale as the axis ticks", () => {
    const html = waterfallSvg(
      buildWaterfall(
        graph([
          { timestamp: 0, duration: 1000 },
          { timestamp: 4000, duration: 2500 },
        ]),
      ),
    )
    const tick = [
      ...html.matchAll(/<g class="wf-tick"><line x1="([\d.]+)"[^>]*\/><text[^>]*>([^<]+)<\/text><\/g>/g),
    ].find((match) => match[2] === "4.0s")
    const bars = [...html.matchAll(/<rect class="wf-bar" x="([\d.]+)"[^>]*width="([\d.]+)"/g)]
    expect(tick).toBeDefined()
    expect(Number(bars[1]![1])).toBe(Number(tick![1]))
    expect(Number(bars[1]![2])).toBe((2500 / 8000) * 780)
  })
  test("builds time-ordered rows relative to the first event and finds the slowest tool", () => {
    const chart = buildWaterfall(
      graph([
        { type: "llm", timestamp: 5000, duration: 800 },
        { type: "tool_call", tool: "read", timestamp: 5900, duration: 50, status: "ok" },
        { type: "tool_call", tool: "bash", timestamp: 6000, duration: 4000, status: "error" },
      ]),
    )
    expect(chart.rows.map((row) => row.start)).toEqual([0, 900, 1000])
    expect(chart.total).toBe(5000)
    expect(chart.slowest?.label).toBe("bash")
    expect(chart.failures).toBe(1)
    expect(chart.hidden).toBe(0)
  })

  test("ignores nodes without a usable timestamp and untimed node types", () => {
    const chart = buildWaterfall(
      graph([
        { type: "session", timestamp: 1 },
        { type: "tool_call", timestamp: Number.NaN },
        { type: "tool_call", tool: "ls", timestamp: 10, duration: 5 },
      ]),
    )
    expect(chart.rows.map((row) => row.label)).toEqual(["ls"])
    expect(buildWaterfall(graph([])).rows).toEqual([])
  })

  test("a long run keeps the slowest and failed rows and counts the rest", () => {
    const nodes = Array.from({ length: 80 }, (_, i) => ({
      type: "tool_call" as const,
      tool: `t${i}`,
      timestamp: 1000 + i * 10,
      duration: i === 7 ? 9000 : 10,
      status: i === 3 ? ("error" as const) : ("ok" as const),
    }))
    const chart = buildWaterfall(graph(nodes))
    expect(chart.rows).toHaveLength(40)
    expect(chart.hidden).toBe(40)
    expect(chart.rows.some((row) => row.label === "t3")).toBe(true)
    expect(chart.rows.some((row) => row.label === "t7")).toBe(true)
    const starts = chart.rows.map((row) => row.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  test("svg escapes hostile labels, marks failures, and gives every bar a tooltip", () => {
    const html = waterfallSvg(
      buildWaterfall(
        graph([
          { type: "tool_call", tool: `<img src=x onerror=alert(1)>`, timestamp: 1, duration: 100, status: "error" },
          { type: "tool_call", tool: "ok", timestamp: 50, duration: 30, tokens: { input: 1200, output: 3 } },
        ]),
      ),
    )
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
    expect(html).toContain("✗ ")
    expect((html.match(/<title>/g) ?? []).length).toBe(2)
    expect(html).toContain("1,200 in / 3 out tokens")
    expect(html).toContain('role="img"')
    expect(html).not.toContain("NaN")
  })

  test("hours of idle waiting are compressed so bars stay visible, and the caption says so", () => {
    const hour = 3_600_000
    const idle = graph([
      { type: "tool_call", tool: "a", timestamp: 0, duration: 1000 },
      { type: "tool_call", tool: "b", timestamp: hour, duration: 1000 },
      { type: "tool_call", tool: "c", timestamp: 2 * hour, duration: 1000 },
    ])
    const chart = buildWaterfall(idle)
    expect(chart.compressed).toEqual({ wall: 2 * hour + 1000, active: 3000 })
    expect(chart.total).toBeLessThan(10_000)
    // Order and durations are preserved; only the idle gaps shrink, and tooltips keep wall-clock offsets.
    expect(chart.rows.map((row) => row.label)).toEqual(["a", "b", "c"])
    expect(chart.rows.map((row) => row.duration)).toEqual([1000, 1000, 1000])
    expect(chart.rows[1].wallStart).toBe(hour)
    expect(chart.rows[1].start).toBeLessThan(5000)
    expect(waterfallSvg(chart)).toContain("starts +1h 0m")
    expect(traceSection({ graph: idle, ganttHref: "/g" })).toContain("idle gaps compressed")
  })

  test("a busy run is never compressed and parallel calls are not double counted", () => {
    const busy = buildWaterfall(
      graph([
        { type: "tool_call", tool: "a", timestamp: 0, duration: 1000 },
        { type: "tool_call", tool: "b", timestamp: 100, duration: 1000 },
      ]),
    )
    expect(busy.compressed).toBeUndefined()
    expect(busy.rows.map((row) => row.start)).toEqual([0, 100])
    expect(busy.total).toBe(1100)
  })

  test("zero-duration calls remain visible as a minimum-width bar", () => {
    const html = waterfallSvg(buildWaterfall(graph([{ type: "tool_call", tool: "x", timestamp: 1, duration: 0 }])))
    expect(html).toMatch(/class="wf-bar"[^>]*width="3"/)
  })

  test("trace section says so when nothing was timed and always links the raw gantt", () => {
    const empty = traceSection({ graph: graph([]), ganttHref: "/graph/s?format=svggantt&directory=%2Ftmp" })
    expect(empty).toContain('id="timeline"')
    expect(empty).toContain("No timed steps were recorded")
    expect(empty).toContain("format=svggantt")
    expect(empty).not.toContain("<svg")
    const full = traceSection({
      graph: graph([{ type: "tool_call", tool: "bash", timestamp: 1, duration: 2500 }]),
      ganttHref: "/g",
    })
    expect(full).toContain("slowest: bash 2.5s")
    expect(full).toContain("no failures")
  })
})
