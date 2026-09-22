import { describe, expect, test } from "vitest"
import { sessionTopBarLayout } from "../../../src/cli/tui/routes/session/top-bar-view-model"

const segments = {
  id: "ses_-e5f3a373",
  title: "Rebrand this project nicely",
  status: "Editing files - 4s",
  share: "https://ax.dev/s/abcd",
  providers: "Providers (6)",
  manage: "manage",
}

describe("session top bar layout", () => {
  test("keeps every segment untruncated when the width allows", () => {
    expect(sessionTopBarLayout({ width: 120, segments })).toEqual(segments)
  })

  test("drops the share url first when space runs out", () => {
    const layout = sessionTopBarLayout({ width: 100, segments })
    expect(layout.share).toBeUndefined()
    expect(layout.id).toBe(segments.id)
    expect(layout.title).toBe(segments.title)
    expect(layout.status).toBe(segments.status)
    expect(layout.providers).toBe(segments.providers)
    expect(layout.manage).toBe(segments.manage)
  })

  test("truncates the title before dropping the status label", () => {
    const layout = sessionTopBarLayout({ width: 80, segments })
    expect(layout.status).toBe(segments.status)
    expect(layout.title).toBeDefined()
    expect(layout.title!.length).toBeLessThan(segments.title.length)
    expect(layout.title!.endsWith("...")).toBe(true)
    expect(layout.share).toBeUndefined()
  })

  test("drops the status label once it no longer fits whole", () => {
    const layout = sessionTopBarLayout({ width: 50, segments })
    expect(layout.status).toBeUndefined()
    expect(layout.id).toBe(segments.id)
    expect(layout.title).toBeDefined()
    expect(layout.providers).toBe(segments.providers)
  })

  test("truncates the session id last under extreme narrowness", () => {
    const layout = sessionTopBarLayout({ width: 32, segments })
    expect(layout.id.length).toBeLessThan(segments.id.length)
    expect(layout.id.endsWith("...")).toBe(true)
    expect(layout.title).toBeUndefined()
    expect(layout.status).toBeUndefined()
    expect(layout.providers).toBe(segments.providers)
    expect(layout.manage).toBe(segments.manage)
  })

  test("drops the manage link before the providers block", () => {
    const layout = sessionTopBarLayout({ width: 28, segments })
    expect(layout.providers).toBe(segments.providers)
    expect(layout.manage).toBeUndefined()
    expect(layout.id).toBe(segments.id)
  })

  test("keeps a short title whole instead of applying the truncation floor", () => {
    const layout = sessionTopBarLayout({ width: 17, segments: { id: segments.id, title: "Hi" } })
    expect(layout.id).toBe(segments.id)
    expect(layout.title).toBe("Hi")
  })

  test("drops the providers block once it no longer fits at all", () => {
    const layout = sessionTopBarLayout({ width: 10, segments })
    expect(layout.providers).toBeUndefined()
    expect(layout.manage).toBeUndefined()
    expect(layout.id.length).toBeLessThanOrEqual(10)
    expect(sessionTopBarLayout({ width: 0, segments })).toEqual({ id: "" })
  })

  test("treats a non-finite width as no room", () => {
    const layout = sessionTopBarLayout({ width: Number.NaN, segments })
    expect(layout).toEqual({ id: "" })
  })

  test("uses the full width when there is no providers block", () => {
    const layout = sessionTopBarLayout({
      width: 60,
      segments: { id: segments.id, title: segments.title, status: segments.status },
    })
    expect(layout.providers).toBeUndefined()
    expect(layout.manage).toBeUndefined()
    expect(layout.id).toBe(segments.id)
    expect(layout.status).toBe(segments.status)
    expect(layout.title).toBeDefined()
  })
})
