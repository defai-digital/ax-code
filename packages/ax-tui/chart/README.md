# ax-tui/chart

Ratatui-style chart widgets for ax-tui, ported from ratatui v0.30.2 rendering
semantics. Pure TypeScript renderables on top of the existing
`Renderable`/`OptimizedBuffer` surface — no native or vendored-snapshot
changes.

## Widgets

- `SparklineRenderable` — block-element series (8 ticks per cell, multi-row).
- `GaugeRenderable` — ratio bar with a centered label, optional unicode edge.
- `BarChartRenderable` — vertical bars with value and label rows.
- `ChartRenderable` — datasets (line/scatter/bar) with dot/block/braille
  markers, axes with bounds/labels/titles, and an auto-hiding legend.
- `BrailleGrid` / `CharGrid` — the pixel-addressable grid substrate (exported
  as a documented utility for future Canvas-style widgets).

## Usage

```ts
import { ChartRenderable, SparklineRenderable } from "@defai-digital/ax-tui/chart"
```

```tsx
import "@defai-digital/ax-tui/chart/solid"

<sparkline data={[1, 4, 2, 8, 5]} color="#7ee787" />
<gauge ratio={0.42} />
<barchart data={[{ label: "a", value: 3 }, { label: "b", value: 7 }]} barWidth={2} />
<chart
  width={60}
  height={15}
  datasets={[{ name: "latency", data: [[0, 1], [1, 5], [2, 3]], graphType: "line", marker: "braille", color: "cyan" }]}
  xAxis={{ bounds: [0, 2], labels: ["0", "1", "2"] }}
  yAxis={{ bounds: [0, 5], labels: ["0", "5"] }}
/>
```

## Contracts

- Axis `bounds` are required (finite pair) whenever an `xAxis`/`yAxis` object
  is given; omit both axes to auto-derive bounds from the data.
- Axis lines render only when the corresponding axis has labels (ratatui rule).
- Non-finite data points are skipped; reversed/degenerate bounds draw no data;
  zero-size areas draw nothing. Nothing throws except invalid axis bounds.
- Braille glyphs use the standard Unicode dot numbering; each dataset renders
  as its own layer (ratatui v0.30 rule), so where two datasets touch the same
  cell the later dataset's cell wins — replaced, not dot-merged. A braille
  cell carries one fg color.

The full algorithm port and the documented deviations from ratatui are recorded
in the internal tech spec (kept out of the public repository).
