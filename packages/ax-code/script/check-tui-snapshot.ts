// Visual design-system snapshot gate (ADR-031, renderer contract
// "visual.design-system-snapshot").
//
// Snapshots the deterministic, renderer-free outputs of the TUI design
// system — brand gradient runs for the logo, gauge fills, border charsets,
// and glyph sets — for both the truecolor and fallback profiles. Catches
// unintended visual drift without booting a terminal.
//
// Usage:
//   bun run script/check-tui-snapshot.ts            # compare against snapshot
//   bun run script/check-tui-snapshot.ts --update   # regenerate snapshot

import path from "node:path"
import type { RGBA } from "@opentui/core"
import { logo } from "../src/cli/logo"
import { gradientLineRuns } from "../src/cli/cmd/tui/ui/primitives/color"
import { formatGauge } from "../src/cli/cmd/tui/ui/primitives/format"
import { RoundedBorder } from "../src/cli/cmd/tui/ui/primitives/card"
import { EmptyBorder, SplitBorder } from "../src/cli/cmd/tui/component/border"
import { buildGlyphSet } from "../src/cli/cmd/tui/ui/glyphs"
import { resolveTheme } from "../src/cli/cmd/tui/context/theme"
import { DEFAULT_THEMES } from "../src/cli/cmd/tui/context/theme-defaults"

const SNAPSHOT_PATH = path.resolve(import.meta.dir, "../test/cli/tui/__snapshots__/visual-design-system.json")
const LOGO_DIAGONAL_BIAS = 3

function hex(color: RGBA): string {
  const u8 = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${u8(color.r)}${u8(color.g)}${u8(color.b)}${color.a < 1 ? u8(color.a) : ""}`
}

function logoGradient(mode: "dark" | "light") {
  const theme = resolveTheme(DEFAULT_THEMES.github, mode)
  const width = logo.reduce((max, line) => Math.max(max, line.length), 0)
  return logo.map((line, row) =>
    gradientLineRuns({
      line,
      row,
      rows: logo.length,
      width,
      from: theme.brandGradientStart,
      to: theme.brandGradientEnd,
      diagonalBias: LOGO_DIAGONAL_BIAS,
    }).map((run) => ({ text: run.text, color: hex(run.color) })),
  )
}

function glyphSamples(nerdFont: boolean) {
  const glyphs = buildGlyphSet(nerdFont)
  return {
    files: Object.fromEntries(
      ["main.ts", "app.tsx", "lib.rs", "tool.py", "doc.md", "data.unknownext"].map((name) => [
        name,
        glyphs.fileType(name),
      ]),
    ),
    folder: glyphs.folder(),
    branch: glyphs.branch(),
  }
}

function buildSnapshot() {
  return {
    contract: "visual.design-system-snapshot",
    logo: {
      truecolor: { dark: logoGradient("dark"), light: logoGradient("light") },
      fallback: {
        dark: hex(resolveTheme(DEFAULT_THEMES.github, "dark").text),
        light: hex(resolveTheme(DEFAULT_THEMES.github, "light").text),
        lines: logo,
      },
    },
    gauge: Object.fromEntries([0, 0.01, 0.42, 0.6, 0.8, 0.95, 1].map((ratio) => [String(ratio), formatGauge(ratio)])),
    borders: { rounded: RoundedBorder, split: SplitBorder.customBorderChars, empty: EmptyBorder },
    glyphs: { nerd: glyphSamples(true), safe: glyphSamples(false) },
  }
}

const actual = JSON.stringify(buildSnapshot(), null, 2) + "\n"
const update = process.argv.includes("--update")

if (update) {
  await Bun.write(SNAPSHOT_PATH, actual)
  console.log(`updated ${path.relative(process.cwd(), SNAPSHOT_PATH)}`)
  process.exit(0)
}

const file = Bun.file(SNAPSHOT_PATH)
if (!(await file.exists())) {
  console.error(`missing snapshot: ${SNAPSHOT_PATH}`)
  console.error("run: bun run script/check-tui-snapshot.ts --update")
  process.exit(1)
}

const expected = await file.text()
if (expected === actual) {
  console.log("ok: tui visual design-system snapshot matches")
  process.exit(0)
}

const actualPath = SNAPSHOT_PATH.replace(/\.json$/, ".actual.json")
await Bun.write(actualPath, actual)
console.error("tui visual design-system snapshot mismatch")
console.error(`expected: ${SNAPSHOT_PATH}`)
console.error(`actual:   ${actualPath}`)
console.error("if the change is intentional, run: bun run script/check-tui-snapshot.ts --update")
process.exit(1)
