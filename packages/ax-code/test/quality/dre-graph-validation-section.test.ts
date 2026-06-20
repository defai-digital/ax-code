import { describe, expect, test } from "vitest"
import { validationSection } from "../../src/quality/dre-graph-validation-section"
import type { SessionRisk } from "../../src/session/risk"

function risk(signals: Partial<SessionRisk.Detail["assessment"]["signals"]>): SessionRisk.Detail {
  return {
    assessment: {
      signals: {
        validationCount: 0,
        validationCommands: [],
        validationState: "not_run",
        filesChanged: 0,
        ...signals,
      },
    },
  } as SessionRisk.Detail
}

describe("quality.dre-graph-validation-section", () => {
  test("renders an empty state when no validation is recorded", () => {
    const html = validationSection({ risk: risk({}) })

    expect(html).toContain(`<section class="band" id="validation">`)
    expect(html).toContain("No validation commands recorded")
    expect(html).not.toContain("validation-list")
  })

  test("renders passed validation commands with escaped command text", () => {
    const html = validationSection({
      risk: risk({
        validationCount: 1,
        validationCommands: [`bun test <x>&`],
        validationState: "passed",
      }),
    })

    expect(html).toContain(`<p>validation passed</p>`)
    expect(html).toContain(`<span class="validation-icon">✓</span>`)
    expect(html).toContain("bun test &lt;x&gt;&amp;")
    expect(html).toContain(`<span class="chip low">passed</span>`)
  })

  test("renders failed commands and not-run code-change warning", () => {
    const failed = validationSection({
      risk: risk({
        validationCount: 1,
        validationCommands: ["pnpm test"],
        validationState: "failed",
      }),
    })
    expect(failed).toContain(`<span class="validation-icon">✗</span>`)
    expect(failed).toContain(`<span class="chip high">failed</span>`)

    const missing = validationSection({
      risk: risk({
        validationCount: 1,
        validationCommands: [],
        validationState: "not_run",
        filesChanged: 2,
      }),
    })
    expect(missing).toContain("No validation commands recorded")
    expect(missing).toContain("Code changed but no tests were run")
  })
})
