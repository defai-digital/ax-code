import { describe, expect, test } from "bun:test"
import path from "path"

const rootPublishScript = path.resolve(import.meta.dir, "../../../../script/publish.ts")

describe("root release publish script", () => {
  test("runs stable release preflight before tagging", async () => {
    const text = await Bun.file(rootPublishScript).text()

    expect(text).toContain("runStableReleasePreflight()")
    expect(text).toContain("withTests: true")
    expect(text).toContain("fetch: true")
    expect(text).toContain("Stable releases must run from main")
  })

  test("pushes verified refs without cherry-picking or force-pushing", async () => {
    const text = await Bun.file(rootPublishScript).text()

    expect(text).toContain("git push origin HEAD:main --no-verify")
    expect(text).toContain("git push origin v${Script.version}")
    expect(text).not.toContain("git cherry-pick HEAD..origin/dev")
    expect(text).not.toContain("--force-with-lease")
  })
})
