import { describe, expect, test } from "bun:test"
import { createFixtureCommandCenterState } from "../../src/projection/replay"
import { createCommandCenterViewModel } from "../../src/projection/view-model"

describe("renderer smoke contract", () => {
  test("fixture first screen exposes command-center essentials", () => {
    const view = createCommandCenterViewModel(createFixtureCommandCenterState())

    expect(view.sessions.length).toBeGreaterThan(0)
    expect(view.queueSummary.total).toBeGreaterThan(0)
    expect(view.queueSummary.running).toBe(1)
    expect(view.goal?.objective).toContain("command center")
    expect(view.permissions.length + view.questions.length).toBeGreaterThan(0)
    expect(view.evidence?.risk?.level).toBe("MEDIUM")
    expect(view.evidence?.artifactCounts.verificationEnvelopes).toBe(2)
    expect(view.catalog.agents.length).toBeGreaterThan(0)
    expect(view.catalog.models.length).toBeGreaterThan(0)
    expect(view.worktrees.length).toBeGreaterThan(0)
    expect(view.terminals.length).toBeGreaterThan(0)
    expect(view.scheduledTasks.length).toBeGreaterThan(0)
  })

  test("app shell keeps basic accessibility landmarks", async () => {
    const source = await Bun.file(new URL("../../src/App.tsx", import.meta.url)).text()

    expect(source).toContain('class="skip-link"')
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain("aria-current")
    expect(source).toContain('role="tab"')
    expect(source).toContain('role="tabpanel"')
    expect(source).toContain("<DiagnosticsPanel")
  })
})
