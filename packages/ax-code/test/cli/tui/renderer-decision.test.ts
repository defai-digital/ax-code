import { describe, expect, test } from "vitest"
import { decideTuiRenderer } from "../../../src/cli/cmd/tui/renderer-decision"

describe("tui renderer decision gate", () => {
  test("retains AX Code TUI without reproducible failures", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: [],
        issueLayer: "product-layer",
        blocksProductDirection: false,
        installOrBuildRiskAccepted: false,
      }).action,
    ).toBe("retain-ax-tui")
  })

  test("does not propose native work for product-layer failures", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: ["transcript.large-append"],
        issueLayer: "product-layer",
        blocksProductDirection: true,
        installOrBuildRiskAccepted: true,
      }).action,
    ).toBe("fix-product-layer")
  })

  test("keeps renderer-specific product blockers in AX Code TUI", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: ["startup.first-frame"],
        issueLayer: "renderer-specific",
        blocksProductDirection: true,
        installOrBuildRiskAccepted: true,
        offlinePackagingDeterministic: true,
      }),
    ).toMatchObject({ action: "improve-ax-tui" })
  })

  test("keeps non-blocking renderer fixes in AX Code TUI", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: ["terminal.resize-stability"],
        issueLayer: "renderer-specific",
        blocksProductDirection: true,
        installOrBuildRiskAccepted: true,
        offlinePackagingDeterministic: false,
      }).action,
    ).toBe("improve-ax-tui")
  })
})
