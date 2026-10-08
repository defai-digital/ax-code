import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const requireCore = createRequire(new URL("../packages/ax-code/package.json", import.meta.url))
const requireDrizzle = createRequire(requireCore.resolve("drizzle-orm"))

export function checkSprintfPrecisionGuard() {
  const parents = [requireDrizzle.resolve("mssql"), requireDrizzle.resolve("@types/mssql/package.json")]
  const checked = new Set()
  for (const parent of parents) {
    const requireParent = createRequire(parent)
    const requireTedious = createRequire(requireParent.resolve("tedious"))
    const filename = requireTedious.resolve("sprintf-js")
    if (checked.has(filename)) continue
    checked.add(filename)
    const { sprintf, vsprintf } = requireTedious("sprintf-js")
    for (const type of ["e", "f", "g"]) {
      for (const precision of ["101", "1000000", "9".repeat(400)]) {
        assert.equal(sprintf(`%.${precision}${type}`, 1.25), sprintf(`%.100${type}`, 1.25))
      }
    }
    assert.equal(sprintf("%.0g", 1.25), sprintf("%.1g", 1.25))
    assert.equal(sprintf("%.0f", 1.75), "2")
    assert.equal(sprintf("%.0e", 1.75), "2e+0")
    assert.equal(sprintf("%s %04d %.2f", "value", 7, 1.25), "value 0007 1.25")
    assert.equal(sprintf("%.3s", "abcdef"), "abc")
    assert.equal(vsprintf("%(value).101f", [{ value: 1.25 }]), sprintf("%.100f", 1.25))
  }
  assert.ok(checked.size > 0, "No installed sprintf-js consumers were checked")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkSprintfPrecisionGuard()
  console.log("Verified installed sprintf-js precision bounds and ordinary formatting compatibility")
}
