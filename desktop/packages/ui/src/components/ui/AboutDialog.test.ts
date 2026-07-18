import { describe, expect, test } from "vitest"

import { aboutVersionRows } from "./aboutVersionRows"

describe("AboutDialog", () => {
  test("deduplicates matching Desktop and CLI versions (#343)", () => {
    expect(aboutVersionRows("6.10.3", "6.10.3")).toEqual([
      { key: "version", label: "aboutDialog.versionLabel", version: "6.10.3" },
    ])
  })

  test("labels differing component versions distinctly", () => {
    expect(aboutVersionRows("6.10.3", "6.10.2")).toEqual([
      { key: "desktop", label: "aboutDialog.openChamberVersionLabel", version: "6.10.3" },
      { key: "cli", label: "aboutDialog.axCodeVersionLabel", version: "6.10.2" },
    ])
  })
})
