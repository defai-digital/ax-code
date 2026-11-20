import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { layoutGauge } from "../chart/src/gauge.js"
import { layoutSparkline } from "../chart/src/sparkline.js"
import { layoutBarChart } from "../chart/src/barchart.js"

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Non-finite sizes must be rejected up front: the layout loops use the raw
// width/height as bounds, so Infinity spins forever. Hang cases run in a
// child process with a hard timeout — never in the vitest worker.
function runLayoutChild(moduleFile: string, callExpr: string) {
  const url = "file://" + path.join(pkgRoot, "chart", "src", moduleFile)
  const fn = callExpr.slice(0, callExpr.indexOf("("))
  const code = `import { ${fn} } from ${JSON.stringify(url)}\nconsole.log("DONE:" + JSON.stringify(${callExpr}))`
  return spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", code], {
    cwd: pkgRoot,
    timeout: 3000,
    encoding: "utf8",
  })
}

function expectEmptyLayout(moduleFile: string, callExpr: string): void {
  const run = runLayoutChild(moduleFile, callExpr)
  expect(run.status, `signal=${run.signal} stdout=${run.stdout} stderr=${run.stderr}`).toBe(0)
  expect(run.stdout).toContain("DONE:[]")
}

test(
  "layoutGauge rejects an infinite width instead of hanging",
  () => {
    expectEmptyLayout("gauge.ts", "layoutGauge({ratio:0.5}, Infinity, 1)")
  },
  15_000,
)

test(
  "layoutGauge rejects an infinite height instead of hanging",
  () => {
    expectEmptyLayout("gauge.ts", "layoutGauge({ratio:0.5}, 1, Infinity)")
  },
  15_000,
)

test(
  "layoutSparkline rejects an infinite height instead of hanging",
  () => {
    expectEmptyLayout("sparkline.ts", "layoutSparkline({data:[1]}, 4, Infinity)")
  },
  15_000,
)

test(
  "layoutBarChart rejects an infinite height instead of hanging",
  () => {
    expectEmptyLayout("barchart.ts", "layoutBarChart({data:[1]}, 4, Infinity)")
  },
  15_000,
)

test(
  "layoutBarChart rejects an infinite width and barWidth instead of hanging",
  () => {
    expectEmptyLayout("barchart.ts", "layoutBarChart({data:[1],barWidth:Infinity}, Infinity, 2)")
  },
  15_000,
)

// Degenerate non-integer sizes never hang (comparisons against NaN are false)
// but still emit cells at fractional or non-finite coordinates. They must
// render nothing, matching layoutChart's existing integer-size guard.
test("layoutGauge renders nothing for NaN or infinite widths", () => {
  expect(layoutGauge({ ratio: 0.5 }, NaN, 1)).toEqual([])
  expect(layoutGauge({ ratio: 0 }, Infinity, 1)).toEqual([])
})

test("layoutSparkline renders nothing for a fractional height", () => {
  expect(layoutSparkline({ data: [1] }, 4, 1.5)).toEqual([])
})

test("layoutBarChart renders nothing for a fractional barWidth or infinite width", () => {
  expect(layoutBarChart({ data: [1], barWidth: 1.5 }, 4, 2)).toEqual([])
  expect(layoutBarChart({ data: [1] }, Infinity, 2)).toEqual([])
})
