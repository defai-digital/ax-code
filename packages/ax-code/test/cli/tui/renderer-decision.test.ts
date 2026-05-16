import { describe, expect, test } from "bun:test"
import { decideTuiRenderer } from "../../../src/cli/cmd/tui/renderer-decision"

describe("tui renderer decision gate", () => {
  test("retains OpenTUI without reproducible failures", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: [],
        issueLayer: "product-layer",
        blocksProductDirection: false,
        installOrBuildRiskAccepted: false,
      }).action,
    ).toBe("retain-opentui")
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

  test("requires product blockage and accepted delivery risk before Rust/native core", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: ["startup.first-frame"],
        issueLayer: "renderer-specific",
        blocksProductDirection: true,
        installOrBuildRiskAccepted: true,
        offlinePackagingDeterministic: true,
      }),
    ).toMatchObject({ action: "propose-rust-native-core", requiresAdr: true })
  })

  test("requires deterministic offline packaging before native work", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: ["terminal.resize-stability"],
        issueLayer: "renderer-specific",
        blocksProductDirection: true,
        installOrBuildRiskAccepted: true,
        offlinePackagingDeterministic: false,
      }).action,
    ).toBe("upstream-or-fork-opentui")
  })
})
