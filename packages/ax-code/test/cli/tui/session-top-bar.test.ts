import { describe, expect, test } from "vitest"
import { sessionTopBarLayout } from "../../../src/cli/tui/routes/session/top-bar-view-model"

const segments = {
  id: "ses_-e5f3a373",
  title: "Rebrand this project nicely",
  status: "Editing files - 4s",
  share: "https://ax.dev/s/abcd",
  providers: "Providers (6)",
}

describe("session top bar layout", () => {
  test("shows the title, live status, technical details, and one provider action when space allows", () => {
    expect(sessionTopBarLayout({ width: 120, segments })).toEqual(segments)
  })

  test("keeps the title and status before the session id as width shrinks", () => {
    const medium = sessionTopBarLayout({ width: 80, segments })
    expect(medium.title).toBe(segments.title)
    expect(medium.status).toBe(segments.status)
    expect(medium.share).toBeUndefined()

    const narrow = sessionTopBarLayout({ width: 50, segments })
    expect(narrow.title).toBeDefined()
    expect(narrow.status).toBeDefined()
    expect(narrow.id).toBeUndefined()
    expect(narrow.providers).toBe(segments.providers)
  })

  test("keeps title and live status before provider controls on an extremely narrow terminal", () => {
    const narrow = sessionTopBarLayout({ width: 32, segments })
    expect(narrow.title).toBeDefined()
    expect(narrow.title!.length).toBeGreaterThanOrEqual(10)
    expect(narrow.status).toBeDefined()
    expect(narrow.id).toBeUndefined()
    expect(narrow.share).toBeUndefined()
    expect(narrow.providers).toBeUndefined()

    const tiny = sessionTopBarLayout({ width: 17, segments })
    expect(tiny.title).toBeDefined()
    expect(tiny.providers).toBeUndefined()
  })

  test("shows the status first when the route header already shows the title", () => {
    const layout = sessionTopBarLayout({ width: 32, segments: { ...segments, title: undefined } })
    expect(layout.status).toBeDefined()
    expect(layout.title).toBeUndefined()
  })

  test("handles zero and invalid widths", () => {
    expect(sessionTopBarLayout({ width: 0, segments })).toEqual({})
    expect(sessionTopBarLayout({ width: Number.NaN, segments })).toEqual({})
  })
})
