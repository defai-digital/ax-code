import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Storage } from "../../src/storage/storage"
import { QualityStorageKey } from "../../src/quality/storage-key"
import { QualityReentryContext } from "../../src/quality/reentry-context"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("quality storage keys", () => {
  test("dot segments stay inside the namespace", () => {
    expect(QualityStorageKey.encode(".")).toBe("%2E")
    expect(QualityStorageKey.encode("..")).toBe("%2E%2E")
    expect(QualityStorageKey.decode(QualityStorageKey.encode(".."))).toBe("..")
    // Ordinary ids keep their historical encoding so existing records stay
    // readable.
    expect(QualityStorageKey.encode("rollback-candidate-v1")).toBe("rollback-candidate-v1")
  })

  test("a dot-segment source writes and lists inside the reentry namespace", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const context = QualityReentryContext.create({
          rollback: {
            source: "..",
            rollbackID: "rlb_dot_segment",
            promotionID: "promo_dot_segment",
            promotedAt: new Date().toISOString(),
            rolledBackAt: new Date().toISOString(),
            previousActiveSource: "previous-v1",
            rollbackTargetSource: "previous-v1",
          },
          watch: {
            overallStatus: "fail",
            window: { totalRecords: 2, sessionsCovered: 2 },
            gates: [{ name: "gate", status: "fail", detail: "gate failed" }],
          },
        })
        await QualityReentryContext.append(context)

        // The record must live under the reentry namespace, not at the
        // storage root, and list() must round-trip the dot-segment source.
        const keys = await Storage.list(["quality_model_reentry_context"])
        expect(keys).toHaveLength(1)
        const latest = await QualityReentryContext.latest("..")
        expect(latest?.contextID).toBe("rlb_dot_segment")
        expect(latest?.source).toBe("..")
      },
    })
  })
})
