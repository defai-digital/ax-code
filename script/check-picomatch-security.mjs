import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parse } from "yaml"

const requireCore = createRequire(new URL("../packages/ax-code/package.json", import.meta.url))
const requireGlob = createRequire(requireCore.resolve("fast-glob"))
const requireMatch = createRequire(requireGlob.resolve("micromatch"))
const requireWatcher = createRequire(requireCore.resolve("@parcel/watcher"))

export const picomatchPaths = [...new Set([requireMatch.resolve("picomatch"), requireWatcher.resolve("picomatch")])]
const MATCH_PROBE_TIMEOUT_MS = 2_000

export function checkPicomatchSecurity() {
  const lock = parse(readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"))
  const versions = Object.keys(lock.packages).filter((key) => key.startsWith("picomatch@"))
  assert.deepEqual(versions.sort(), ["picomatch@2.3.2", "picomatch@4.0.7"])
  for (const version of versions) {
    assert.equal(lock.patchedDependencies[version]?.path, `patches/${version}.patch`)
  }
  for (const modulePath of picomatchPaths) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--probe", modulePath], {
      encoding: "utf8",
      timeout: MATCH_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    })
    assert.equal(result.error, undefined, `picomatch must finish hostile glob matching: ${result.error?.message}`)
    assert.equal(result.status, 0, result.stderr || "picomatch security probe failed")
  }
}

function probe(modulePath) {
  const picomatch = createRequire(import.meta.url)(modulePath)
  for (const [pattern, input, options] of [
    ["+(*a)", "a".repeat(256) + "b"],
    ["*(*a)", "a".repeat(256) + "b"],
    ["+(*)c", "a".repeat(256) + "b"],
    ["+(a*)c", "a".repeat(256) + "b"],
    ["+(*[ab])", "a".repeat(256) + "c"],
    ["+(@(a)*)", "a".repeat(256) + "b"],
    ["+(ab|abab)", "ab".repeat(128) + "c"],
    ["+(aa|aaa)", "a".repeat(256) + "b"],
    ["+(a|ab|b)", "ab".repeat(128) + "!"],
    ["+(foo|foobar|bar)", "foobar".repeat(128) + "!"],
    ["+(abab|ababab)", "ab".repeat(128) + "c"],
    ["+(a|[a])", "a".repeat(256) + "b"],
    ["+(ab|a?)", "ab".repeat(128) + "c"],
    ["+([[]*)", "[".repeat(256) + "!"],
    ["+([[]*)c", "[".repeat(256) + "!"],
    ["+(aa|AA)", "a".repeat(256) + "b", { nocase: true }],
    ["+(σσ|ςς)", "σ".repeat(256) + "b", { flags: "iu" }],
  ]) {
    assert.equal(picomatch(pattern, options)(input), false, pattern)
  }
  for (const [pattern, input, expected, options] of [
    ["+(*)c", "abc", true],
    ["+(*a)", "a.a", true],
    ["+(*a)", "ab", false],
    ["+(a*b)", "axbayb", true],
    ["+(a*b)", "axbay", false],
    ["*(*.js)", "foo.js", true],
    ["*(*.js)", "foo.ts", false],
    ["src/**/*.ts", "src/nested/file.ts", true],
    ["src/**/*.ts", "src/nested/file.js", false],
    ["*.+(js|jsx)", "file.jsx", true],
    ["+(foo|bar)", "foobar", true],
    ["+(ab|aba)", "ababa", true],
    ["\\*a", "*a", true],
    ["src/[ab]*.ts", "src/abc.ts", true],
    ["src/[ab]*.ts", "src/c.ts", false],
    ["+(straße|strasse)", "straße", true, { nocase: true }],
    ["+(ı|i)", "ı", true, { flags: "iu" }],
    ["+(.|A)", ".A", true, { flags: "iu" }],
    ["+(-|a)", "-a", true, { flags: "iu" }],
    ["+([/]*)", "//", false],
    ["+([/]*)", "+([/]*)", true],
  ]) {
    assert.equal(picomatch(pattern, options)(input), expected, `${pattern}: ${input}`)
  }
  const largeAlternation = `+(${Array.from({ length: 70 }, (_, index) => `word${index}`).join("|")})`
  assert.equal(picomatch(largeAlternation)("word1word2"), false)
  assert.equal(picomatch(largeAlternation)(largeAlternation), true)
}

if (process.argv[2] === "--probe") {
  probe(process.argv[3])
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkPicomatchSecurity()
  console.log("Verified installed picomatch ReDoS backports and ordinary glob behavior")
}
