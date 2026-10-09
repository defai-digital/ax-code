import { expect, test } from "vitest"
import { PAGES } from "../fixture/webmcp/pages"

// Static guard: the qualification fixtures (PRD R14) must keep covering the
// risky shapes. Live qualification against Chrome 150+ is opt-in via
// AX_TEST_WEBMCP_CHROME and is recorded under .internal/reports/.
test("the T2 qualification fixtures cover each risky page shape", () => {
  expect(Object.keys(PAGES).sort()).toEqual(["/continue", "/dialogs", "/inject", "/link", "/login", "/rerender", "/spa"])
  expect(PAGES["/login"]).toContain('type="password"')
  expect(PAGES["/link"]).toContain("Learn more")
  expect(PAGES["/continue"]).toContain("<button>Continue</button>")
  expect(PAGES["/dialogs"]).toContain("confirm(")
  expect(PAGES["/dialogs"]).toContain("prompt(")
  expect(PAGES["/inject"]).toContain("uid=1_1")
  expect(PAGES["/rerender"]).toContain("innerHTML")
  expect(PAGES["/spa"]).toContain("pushState")
})
