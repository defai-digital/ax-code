import { expect, test } from "vitest"
import { createReportLink } from "../../src/quality/run-report/run-report-links"

test("preserves query context, applies explicit overrides, and escapes link text", () => {
  const base = new URLSearchParams("directory=/repo/a b&quality=false&quality=true")
  const link = createReportLink(base)
  expect(link("/run-report?view=summary", '<Review> & "trace"', { quality: "false" })).toBe(
    '<a href="/run-report?view=summary&amp;directory=%2Frepo%2Fa+b&amp;quality=false">&lt;Review&gt; &amp; &quot;trace&quot;</a>',
  )
  expect(base.getAll("quality")).toEqual(["false", "true"])
  expect(link("/run-report", "Next")).toBe('<a href="/run-report?directory=%2Frepo%2Fa+b&amp;quality=true">Next</a>')
})
