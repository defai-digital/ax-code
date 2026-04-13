import { describe, expect, test } from "bun:test"
import { decideTuiRenderer } from "../../../src/cli/cmd/tui/renderer-decision"

describe("tui renderer decision gate", () => {
  test("retains OpenTUI without reproducible failures", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: [],
        rendererSpecific: false,
        blocksProductDirection: false,
        installOrBuildRiskAccepted: false,
      }).action,
    ).toBe("retain-opentui")
  })

  test("does not propose native work for product-layer failures", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: ["transcript.large-append"],
        rendererSpecific: false,
        blocksProductDirection: true,
        installOrBuildRiskAccepted: true,
      }).action,
    ).toBe("fix-product-layer")
  })

  test("requires product blockage and accepted delivery risk before Rust/native core", () => {
    expect(
      decideTuiRenderer({
        criteriaFailures: ["startup.first-frame"],
        rendererSpecific: true,
        blocksProductDirection: true,
        installOrBuildRiskAccepted: true,
      }),
    ).toMatchObject({ action: "propose-rust-native-core", requiresAdr: true })
  })
})
