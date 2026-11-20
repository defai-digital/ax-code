import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Styled-text helpers must map reverse to the INVERSE bit, OR-merge attributes
// and preserve chunk metadata when re-styling, and handle nullish inputs.
test.skipIf(!supportsFfi)("styled-text attribute mapping, chunk metadata, and nullish inputs", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { bold, red, reverse, link, t, TextAttributes } from "@defai-digital/ax-tui"

// reverse must set the INVERSE attribute bit, not be silently dropped.
assert.ok(reverse("x").attributes & TextAttributes.INVERSE)
// Re-styling OR-merges attributes instead of replacing the existing ones.
assert.equal(reverse(bold("x")).attributes, TextAttributes.BOLD | TextAttributes.INVERSE)

// Re-styling a measured chunk keeps its content offsets.
const measured = { __isChunk: true, text: "x", contentStart: 2, contentEnd: 5 }
const restyled = red(measured)
assert.equal(restyled.contentStart, 2)
assert.equal(restyled.contentEnd, 5)

// link keeps existing colors and adds the URL.
const linked = link("https://example.com")(red("x"))
assert.ok(linked.fg)
assert.equal(linked.link.url, "https://example.com")

// null renders as "null"; undefined interpolations are skipped.
assert.equal(bold(null).text, "null")
assert.equal(link("https://example.com")(null).text, "null")
assert.equal(t\`\${null}\`.chunks.map((chunk) => chunk.text).join(""), "null")
assert.equal(t\`a\${undefined}b\`.chunks.map((chunk) => chunk.text).join(""), "ab")
assert.equal(bold(42).text, "42")
console.log("styled-text checks passed")
`,
    ],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})