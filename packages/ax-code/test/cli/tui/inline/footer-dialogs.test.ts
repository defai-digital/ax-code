import { expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { FOOTER_DIALOGS, footerDialogPolicy } from "../../../../src/cli/tui/inline/footer-dialogs"

const root = path.resolve(import.meta.dirname, "../../../../src/cli/tui")

test("only the five small dialogs opt into the footer; every registered loader has a safe policy", () => {
  expect(FOOTER_DIALOGS).toEqual(["command", "model", "agent", "confirm", "alert"])
  const source = fs.readFileSync(path.join(root, "tui-dialogs.tsx"), "utf8")
  const loaders = [...source.matchAll(/show(\w+)Dialog:\s*[\s\S]*?replaceLazyDialog\(\{([\s\S]*?)load: async/g)]
  expect(loaders.length).toBeGreaterThan(10)
  for (const [, name, options] of loaders) {
    const kind = options.match(/footerKind: "(\w+)"/)?.[1]
    expect(footerDialogPolicy(kind)).toBe(["Model", "Agent"].includes(name) ? "footer" : "hint")
  }
  for (const kind of [...FOOTER_DIALOGS, "image", "setup", "provider", "future-dialog", undefined]) {
    expect(footerDialogPolicy(kind)).toBe(kind && FOOTER_DIALOGS.includes(kind as never) ? "footer" : "hint")
  }
  const host = fs.readFileSync(path.join(root, "ui/dialog.tsx"), "utf8")
  expect(host.indexOf('footerDialogPolicy(footerKind) === "hint"')).toBeLessThan(host.indexOf("element: input"))
})
