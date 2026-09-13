import { describe, expect, test } from "vitest"
import { setupGuidance } from "../../../src/cli/cmd/tui/component/setup-guidance"

const base = {
  providerLoaded: true,
  providerFailed: false,
  modelReady: true,
  providers: [{ id: "provider", models: { model: {} } }],
  model: { providerID: "provider", modelID: "model" },
  sessionLoaded: true,
  sessionCount: 0,
}

describe("setup guidance", () => {
  test("initial and returning users can recover a dismissed empty-provider picker", () => {
    for (const sessionCount of [0, 10]) {
      const guidance = setupGuidance({ ...base, sessionCount, providers: [] })
      expect(guidance.state).toBe("connect")
      expect(guidance.action?.command).toBe("provider.connect")
      expect(guidance.modelCommand).toBe("provider.connect")
      expect(guidance.showIntroduction).toBe(false)
    }
  })
  test.each([undefined, { providerID: "removed", modelID: "model" }, { providerID: "provider", modelID: "removed" }])(
    "missing or stale model selection offers the existing model command",
    (model) => {
      expect(setupGuidance({ ...base, model }).action?.command).toBe("model.list")
    },
  )
  test("loading inventory is not a first-time user, and loading has no time promise", () => {
    expect(setupGuidance({ ...base, sessionLoaded: false }).showIntroduction).toBe(false)
    const loading = setupGuidance({ ...base, providerLoaded: false })
    expect(loading.state).toBe("loading")
    expect(loading.message).not.toMatch(/second|10/)
    expect(loading.action).toBeUndefined()
  })
  test("failed discovery offers an actual recovery command before loading", () => {
    const guidance = setupGuidance({ ...base, providerFailed: true, providerLoaded: false })
    expect(guidance.action?.command).toBe("ax-code.status")
    expect(guidance.showIntroduction).toBe(false)
  })
  test("selected model shows introductory help only for a known empty inventory", () => {
    expect(setupGuidance(base)).toMatchObject({ state: "selected", showIntroduction: true })
    expect(setupGuidance({ ...base, sessionCount: 1 }).showIntroduction).toBe(false)
  })
})
