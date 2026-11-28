import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

type SdkManifest = {
  exports: Record<string, string>
}

const packageRoot = resolve(import.meta.dirname, "..")
const sdkManifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as SdkManifest

const EXPORT_RE =
  /^export (?:declare )?(?:async )?(?:abstract class|class|interface|type|const|let|var|enum|function|namespace) ([A-Za-z0-9_]+)/
const STAR_RE = /^export type \* from "([^"]+)"/
const STAR2_RE = /^export \* from "([^"]+)"/
const NAMED_RE = /^export (?:type )?\{([^}]+)\}(?: from "([^"]+)")?/

function hasLeadingDoc(lines: string[], index: number): boolean {
  for (let j = index - 1; j >= 0; j--) {
    const trimmed = lines[j].trim()
    if (trimmed === "") continue
    return trimmed.endsWith("*/")
  }
  return false
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec)
  const withoutJs = base.replace(/\.js$/, "")
  const candidates = [`${withoutJs}.d.ts`, `${withoutJs}.ts`, `${base}.d.ts`, `${base}.ts`, base]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function sourceForExport(target: string): string {
  return join(packageRoot, target.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"))
}

type SymbolRecord = { name: string; file: string; documented: boolean }

function analyzeFile(file: string, seen = new Set<string>()): SymbolRecord[] {
  if (seen.has(file) || !existsSync(file)) return []
  seen.add(file)
  const lines = readFileSync(file, "utf8").split("\n")
  const out: SymbolRecord[] = []
  const rel = relative(packageRoot, file)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart()
    const star = line.match(STAR_RE) ?? line.match(STAR2_RE)
    if (star) {
      const target = resolveImport(file, star[1])
      if (target) out.push(...analyzeFile(target, seen))
      continue
    }

    const named = line.match(NAMED_RE)
    if (named?.[2]) {
      const target = resolveImport(file, named[2])
      const names = named[1]
        .split(",")
        .map((part) =>
          part
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)
            .pop()
            ?.trim(),
        )
        .filter((name): name is string => Boolean(name) && name !== "*")
      if (!target) {
        out.push(...names.map((name) => ({ name, file: rel, documented: false })))
        continue
      }
      const origin = new Map(analyzeFile(target, new Set()).map((symbol) => [symbol.name, symbol.documented]))
      for (const name of names) {
        out.push({ name, file: relative(packageRoot, target), documented: origin.get(name) === true })
      }
      continue
    }

    const match = line.match(EXPORT_RE)
    if (!match) continue
    out.push({ name: match[1], file: rel, documented: hasLeadingDoc(lines, i) })
  }
  return out
}

const REGISTRY_LINE = "@defai-digital:registry=https://npm.pkg.github.com"
const AUTH_TOKEN_LINE = "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}"
const INSTALL_COMMAND = "pnpm add @defai-digital/ax-code-sdk"
const LISTING_LINK = "](https://github.com/orgs/defai-digital/packages/npm/package/ax-code-sdk)"
const INSTALL_INFOS = new Set(["bash", "sh", "shell"])

function readSdkReadme(): string {
  return readFileSync(resolve(packageRoot, "README.md"), "utf8")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "")
}

type FencedBlock = {
  info: string
  fenceChar: string
  fenceLength: number
  indent: number
  lines: string[]
  lineSpans: Array<{ start: number; end: number }>
  start: number
  end: number
}

// A fence opener is 3+ backticks or tildes indented up to three spaces; the
// info string is whatever follows. A closer uses the same character, is at
// least as long, indented up to three spaces, and has only whitespace after it.
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/

// CommonMark removes up to N leading spaces from content lines when the fence
// opener is indented N spaces, so a fence nested in a list item still yields
// the same content as an unindented fence.
function stripFenceIndent(line: string, indent: number): string {
  let remove = 0
  while (remove < indent && line.charAt(remove) === " ") remove++
  return line.slice(remove)
}

function fencedBlocks(markdown: string): FencedBlock[] {
  const blocks: FencedBlock[] = []
  let current: FencedBlock | undefined
  let index = 0
  while (index <= markdown.length) {
    const newline = markdown.indexOf("\n", index)
    const lineEnd = newline === -1 ? markdown.length : newline
    const rawLine = markdown.slice(index, lineEnd)
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (current) {
      const close = FENCE_CLOSE_RE.exec(line)
      const closingFence = close?.[2]
      if (closingFence && closingFence.charAt(0) === current.fenceChar && closingFence.length >= current.fenceLength) {
        current.end = lineEnd
        blocks.push(current)
        current = undefined
      } else {
        // Lines inside a fence never open a new fence.
        current.lines.push(stripFenceIndent(line, current.indent))
        current.lineSpans.push({ start: index, end: lineEnd })
      }
    } else {
      const open = FENCE_OPEN_RE.exec(line)
      const openingFence = open?.[2]
      if (openingFence) {
        current = {
          info: (open?.[3] ?? "").trim(),
          fenceChar: openingFence.charAt(0),
          fenceLength: openingFence.length,
          indent: (open?.[1] ?? "").length,
          lines: [],
          lineSpans: [],
          start: index,
          end: lineEnd,
        }
      }
    }
    if (newline === -1) break
    index = newline + 1
  }
  if (current) {
    current.end = markdown.length
    blocks.push(current)
  }
  return blocks
}

function stripFencedBlocks(markdown: string): string {
  let result = ""
  let cursor = 0
  for (const block of fencedBlocks(markdown)) {
    result += markdown.slice(cursor, block.start)
    cursor = block.end
  }
  return result + markdown.slice(cursor)
}

function exactLineIndex(lines: string[], expected: string): number {
  const pattern = new RegExp(`^${escapeRegExp(expected)}[ \\t]*\\r?$`)
  return lines.findIndex((line) => pattern.test(line))
}

function hasExactLine(lines: string[], expected: string): boolean {
  return exactLineIndex(lines, expected) !== -1
}

// Remove a parsed content line using its real source span, so this works for
// fences nested under list items where the line is indented.
function removeFencedLine(markdown: string, block: FencedBlock, expected: string): string {
  const index = exactLineIndex(block.lines, expected)
  const span = block.lineSpans[index]
  if (index === -1 || !span) return markdown
  const end = markdown[span.end] === "\n" ? span.end + 1 : span.end
  return `${markdown.slice(0, span.start)}${markdown.slice(end)}`
}

function replaceFencedBlock(markdown: string, block: FencedBlock, replacement: string): string {
  return `${markdown.slice(0, block.start)}${replacement}${markdown.slice(block.end)}`
}

// Move a fence under a numbered list item and indent its lines, as a README
// author would when converting the example into a step. Strip the block's
// existing opener indent first so a fence already nested under a list item does
// not end up indented 4+ spaces, which would turn it into an indented code
// block instead of a fence.
function moveFenceUnderStep(markdown: string, block: FencedBlock, step: string, pad = 3): string {
  const padding = " ".repeat(pad)
  const fence = markdown
    .slice(block.start, block.end)
    .split("\n")
    .map((line) => {
      const normalized = stripFenceIndent(line, block.indent)
      return normalized.trim() === "" ? normalized : `${padding}${normalized}`
    })
    .join("\n")
  return `${markdown.slice(0, block.start)}${step}\n\n${fence}${markdown.slice(block.end)}`
}

function hasNpmrcSetup(markdown: string): boolean {
  return fencedBlocks(stripHtmlComments(markdown))
    .filter((block) => block.info === "ini")
    .some((block) => hasExactLine(block.lines, REGISTRY_LINE) && hasExactLine(block.lines, AUTH_TOKEN_LINE))
}

function hasVisibleInstallExample(markdown: string): boolean {
  return fencedBlocks(stripHtmlComments(markdown))
    .filter((block) => INSTALL_INFOS.has(block.info))
    .some((block) => hasExactLine(block.lines, INSTALL_COMMAND))
}

function documentsPinnedInstall(markdown: string): boolean {
  const versionAfterAt = /ax-code-sdk@(?!<version>)(?:[<>^~=]|v?\d|sdk-v\d)/
  const backtickedName = /`@defai-digital\/ax-code-sdk`[ \t]+(?:(?:[<>]=?|=|\^|~)[ \t]*)?v?\d+\.\d/
  const jsonDependency = /"@defai-digital\/ax-code-sdk"\s*:\s*"(?:(?:[<>]=?|[=^~])\s*)?v?\d/
  return versionAfterAt.test(markdown) || backtickedName.test(markdown) || jsonDependency.test(markdown)
}

function hasStatusLine(markdown: string): boolean {
  const visible = stripFencedBlocks(stripHtmlComments(markdown))
  return /^[ \t]*(?:>[ \t]*|[-*+][ \t]+)?(?:\*\*|__|\*|_)?Status(?:\*\*|__|\*|_)?:/im.test(visible)
}

function collapseWhitespace(markdown: string): string {
  return markdown.replace(/\s+/g, " ").trim()
}

function hasExactHeading(markdown: string): boolean {
  return /^# @defai-digital\/ax-code-sdk[ \t]*\r?$/m.test(stripFencedBlocks(stripHtmlComments(markdown)))
}

function hasListingLink(markdown: string): boolean {
  return stripFencedBlocks(stripHtmlComments(markdown)).includes(LISTING_LINK)
}

describe("SDK documentation contract", () => {
  test("every named entrypoint has a module doc with @module", () => {
    const missing: string[] = []
    for (const [entry, target] of Object.entries(sdkManifest.exports)) {
      if (entry === ".") continue
      const source = sourceForExport(target)
      expect(existsSync(source), `missing source for ${entry}: ${source}`).toBe(true)
      const text = readFileSync(source, "utf8")
      const header = text.slice(0, 1200)
      if (!/\/\*\*[\s\S]*@module\b/.test(header)) missing.push(entry)
    }
    expect(missing, `entrypoints missing @module: ${missing.join(", ")}`).toEqual([])
  })

  test("keeps the default entrypoint free of @module and documents its public surface", () => {
    const source = sourceForExport(sdkManifest.exports["."])
    const header = readFileSync(source, "utf8").slice(0, 1200)
    expect(header).not.toMatch(/@module\b/)
    expect(header.startsWith("/**")).toBe(true)
  })

  test("documents at least 80% of exported symbols across SDK entrypoints", () => {
    const documented: SymbolRecord[] = []
    const undocumented: SymbolRecord[] = []
    for (const target of Object.values(sdkManifest.exports)) {
      for (const symbol of analyzeFile(sourceForExport(target))) {
        if (symbol.documented) documented.push(symbol)
        else undocumented.push(symbol)
      }
    }
    const total = documented.length + undocumented.length
    const percent = total === 0 ? 100 : (100 * documented.length) / total
    const preview = undocumented
      .slice(0, 20)
      .map((symbol) => `${symbol.file}#${symbol.name}`)
      .join(", ")
    expect(
      percent,
      `documented ${documented.length}/${total} (${percent.toFixed(1)}%). Missing: ${preview}`,
    ).toBeGreaterThanOrEqual(80)
  })

  test("documents every handwritten public export", () => {
    const generated = new Set(["./v2", "./v2/client", "./v2/gen/client"])
    const missing: string[] = []
    for (const [entry, target] of Object.entries(sdkManifest.exports)) {
      if (generated.has(entry)) continue
      for (const symbol of analyzeFile(sourceForExport(target))) {
        if (!symbol.documented) missing.push(`${entry} ${symbol.file}#${symbol.name}`)
      }
    }
    expect(missing, `undocumented handwritten exports:\n${missing.join("\n")}`).toEqual([])
  })

  test("locks the documented .npmrc registry and token lines", () => {
    const readme = readSdkReadme()
    expect(hasNpmrcSetup(readme)).toBe(true)
    expect(readme).toContain("read:packages")

    const findIniBlock = (markdown: string) =>
      fencedBlocks(markdown).find(
        (block) =>
          block.info === "ini" &&
          hasExactLine(block.lines, REGISTRY_LINE) &&
          hasExactLine(block.lines, AUTH_TOKEN_LINE),
      )

    const iniBlock = findIniBlock(readme)
    if (!iniBlock) throw new Error("README is missing the .npmrc ini fence")

    const withoutRegistry = removeFencedLine(readme, iniBlock, REGISTRY_LINE)
    expect(withoutRegistry).not.toBe(readme)
    expect(hasNpmrcSetup(withoutRegistry)).toBe(false)

    const withoutToken = removeFencedLine(readme, iniBlock, AUTH_TOKEN_LINE)
    expect(withoutToken).not.toBe(readme)
    expect(hasNpmrcSetup(withoutToken)).toBe(false)

    const commentedOutIni = replaceFencedBlock(
      readme,
      iniBlock,
      `<!--\n${readme.slice(iniBlock.start, iniBlock.end)}\n-->`,
    )
    expect(commentedOutIni).not.toBe(readme)
    expect(hasNpmrcSetup(commentedOutIni)).toBe(false)

    const tildeWrappedIni = replaceFencedBlock(
      readme,
      iniBlock,
      `\n~~~markdown\n${readme.slice(iniBlock.start, iniBlock.end)}\n~~~\n`,
    )
    expect(tildeWrappedIni).not.toBe(readme)
    expect(hasNpmrcSetup(tildeWrappedIni)).toBe(false)

    // A README author may move the example into a numbered step; fences
    // indented up to three spaces are still fences and their content lines
    // drop the opener's indentation.
    const indentedIni = moveFenceUnderStep(readme, iniBlock, "1. Configure .npmrc")
    expect(hasNpmrcSetup(indentedIni)).toBe(true)
    const indentedIniBlock = findIniBlock(indentedIni)
    if (!indentedIniBlock) throw new Error("indented README is missing the .npmrc ini fence")
    const indentedWithoutRegistry = removeFencedLine(indentedIni, indentedIniBlock, REGISTRY_LINE)
    expect(indentedWithoutRegistry).not.toBe(indentedIni)
    expect(hasNpmrcSetup(indentedWithoutRegistry)).toBe(false)
    const indentedWithoutToken = removeFencedLine(indentedIni, indentedIniBlock, AUTH_TOKEN_LINE)
    expect(indentedWithoutToken).not.toBe(indentedIni)
    expect(hasNpmrcSetup(indentedWithoutToken)).toBe(false)

    // A README variant that already nests the fence two spaces under a list
    // item must survive another move: the existing opener indent is normalized
    // before the helper adds its own three-space pad.
    const nestedIni = moveFenceUnderStep(readme, iniBlock, "1. Configure .npmrc", 2)
    expect(hasNpmrcSetup(nestedIni)).toBe(true)
    const nestedIniBlock = findIniBlock(nestedIni)
    if (!nestedIniBlock) throw new Error("nested README is missing the .npmrc ini fence")
    const movedNestedIni = moveFenceUnderStep(nestedIni, nestedIniBlock, "1. Configure .npmrc")
    expect(hasNpmrcSetup(movedNestedIni)).toBe(true)
  })

  test("requires a visible shell install example", () => {
    const readme = readSdkReadme()
    expect(hasVisibleInstallExample(readme)).toBe(true)

    // Locate the actual install fence so the mutations track the README's real
    // info string and contents instead of a hardcoded single-line fence.
    const installBlock = fencedBlocks(readme).find(
      (block) => INSTALL_INFOS.has(block.info) && hasExactLine(block.lines, INSTALL_COMMAND),
    )
    if (!installBlock) throw new Error("README is missing a shell install fence")
    const originalBlock = readme.slice(installBlock.start, installBlock.end)
    const replaceInstallBlock = (replacement: string) => replaceFencedBlock(readme, installBlock, replacement)

    const proseOnly = replaceInstallBlock(INSTALL_COMMAND)
    expect(proseOnly).not.toBe(readme)
    expect(hasVisibleInstallExample(proseOnly)).toBe(false)

    const inIniFence = replaceInstallBlock(`\`\`\`ini\n${INSTALL_COMMAND}\n\`\`\``)
    expect(inIniFence).not.toBe(readme)
    expect(hasVisibleInstallExample(inIniFence)).toBe(false)

    const commentedOut = replaceInstallBlock(`<!--\n${originalBlock}\n-->`)
    expect(commentedOut).not.toBe(readme)
    expect(hasVisibleInstallExample(commentedOut)).toBe(false)

    const tildeWrapped = replaceInstallBlock(`\n~~~markdown\n${originalBlock}\n~~~`)
    expect(tildeWrapped).not.toBe(readme)
    expect(hasVisibleInstallExample(tildeWrapped)).toBe(false)

    // Moving the install example under a numbered step and indenting it three
    // spaces must not hide it, and the mutations must still work on that form.
    const indentedInstall = moveFenceUnderStep(readme, installBlock, "1. Install the SDK")
    expect(hasVisibleInstallExample(indentedInstall)).toBe(true)
    const indentedInstallBlock = fencedBlocks(indentedInstall).find(
      (block) => INSTALL_INFOS.has(block.info) && hasExactLine(block.lines, INSTALL_COMMAND),
    )
    if (!indentedInstallBlock) throw new Error("indented README is missing a shell install fence")
    const indentedOriginalBlock = indentedInstall.slice(indentedInstallBlock.start, indentedInstallBlock.end)
    for (const [label, replacement] of [
      ["prose", INSTALL_COMMAND],
      ["ini fence", `\`\`\`ini\n${INSTALL_COMMAND}\n\`\`\``],
      ["commented", `<!--\n${indentedOriginalBlock}\n-->`],
      ["tilde", `\n~~~markdown\n${indentedOriginalBlock}\n~~~`],
    ] as const) {
      const mutated = replaceFencedBlock(indentedInstall, indentedInstallBlock, replacement)
      expect(mutated, `indented install ${label} mutation`).not.toBe(indentedInstall)
      expect(hasVisibleInstallExample(mutated), `indented install ${label} mutation`).toBe(false)
    }

    // A README variant that already nests the install fence two spaces under a
    // list item must survive another move: the existing opener indent is
    // normalized before the helper adds its own three-space pad.
    const nestedInstall = moveFenceUnderStep(readme, installBlock, "1. Install the SDK", 2)
    expect(hasVisibleInstallExample(nestedInstall)).toBe(true)
    const nestedInstallBlock = fencedBlocks(nestedInstall).find(
      (block) => INSTALL_INFOS.has(block.info) && hasExactLine(block.lines, INSTALL_COMMAND),
    )
    if (!nestedInstallBlock) throw new Error("nested README is missing a shell install fence")
    const movedNestedInstall = moveFenceUnderStep(nestedInstall, nestedInstallBlock, "1. Install the SDK")
    expect(hasVisibleInstallExample(movedNestedInstall)).toBe(true)
  })

  test("documents no pinned SDK installs", () => {
    const readme = readSdkReadme()
    expect(documentsPinnedInstall(readme)).toBe(false)

    for (const suffix of ["@2.6.94", "@^2.6.94", "@~2", "@v2.6.94", "@<2.7.0", "@<=2.6", "@sdk-v2.6.94"]) {
      expect(documentsPinnedInstall(`${readme}\npnpm add @defai-digital/ax-code-sdk${suffix}\n`)).toBe(true)
    }
    expect(documentsPinnedInstall(`${readme}\n\`@defai-digital/ax-code-sdk\` 2.6.93\n`)).toBe(true)
    expect(documentsPinnedInstall(`${readme}\n\`@defai-digital/ax-code-sdk@2.6\`\n`)).toBe(true)
    expect(documentsPinnedInstall(`${readme}\n"@defai-digital/ax-code-sdk": "2.6.94"\n`)).toBe(true)
    for (const range of [">=2.6.94", "<=2.6", ">= 2.6.0"]) {
      expect(documentsPinnedInstall(`${readme}\n"@defai-digital/ax-code-sdk": "${range}"\n`)).toBe(true)
    }

    // The placeholder form used by the upgrade instructions stays allowed.
    expect(documentsPinnedInstall(`${readme}\n\`pnpm add --save-exact @defai-digital/ax-code-sdk@<version>\`\n`)).toBe(
      false,
    )

    // A backticked bare package name is not a pin unless a version follows on
    // the same line.
    for (const prose of [
      "Install `@defai-digital/ax-code-sdk`\n\n> Note: never pin in the README.",
      "Install `@defai-digital/ax-code-sdk`\n\n1. Configure .npmrc",
      "`@defai-digital/ax-code-sdk` => headless",
    ]) {
      expect(documentsPinnedInstall(`${readme}\n${prose}\n`)).toBe(false)
    }
  })

  test("checks phrases whitespace-insensitively and rejects status banners", () => {
    const readme = readSdkReadme()
    const phrase = collapseWhitespace("as the public `@defai-digital/ax-code-sdk` package")
    expect(collapseWhitespace(readme)).toContain(phrase)

    const phraseWords = ["as", "the", "public", "`@defai-digital/ax-code-sdk`", "package"]
    const phrasePattern = new RegExp(phraseWords.map(escapeRegExp).join("\\s+"))
    const mutatePhrase = (markdown: string): string => {
      const match = phrasePattern.exec(markdown)
      if (!match) throw new Error("README is missing the public package phrase")
      // Always change the whitespace layout, otherwise a README that already
      // uses the wrapped form would make this mutation a no-op.
      const replacement = match[0].includes("\n") ? phraseWords.join(" ") : phraseWords.join("\n")
      return markdown.replace(phrasePattern, replacement)
    }

    const wrapped = mutatePhrase(readme)
    expect(wrapped).not.toBe(readme)
    expect(collapseWhitespace(wrapped)).toContain(phrase)

    const fixedWrapped = "as the public\n`@defai-digital/ax-code-sdk`\npackage"
    const alreadyWrapped = readme.replace(phrasePattern, fixedWrapped)
    expect(alreadyWrapped).toContain(fixedWrapped)
    const reflowedPhrase = mutatePhrase(alreadyWrapped)
    expect(reflowedPhrase).not.toBe(alreadyWrapped)
    expect(collapseWhitespace(reflowedPhrase)).toContain(phrase)

    expect(collapseWhitespace(readme).toLowerCase()).not.toContain("first public version has not been published")
    expect(collapseWhitespace(`${readme}\nFirst public version has not been published\n`).toLowerCase()).toContain(
      "first public version has not been published",
    )

    expect(hasStatusLine(readme)).toBe(false)
    for (const status of [
      "Status: Active",
      "**Status:** Active",
      "> Status: Active",
      "- Status: Active",
      "_Status:_ Active",
    ]) {
      expect(hasStatusLine(`${readme}\n${status}\n`)).toBe(true)
    }

    for (const safe of [
      '```ts\nstatus: "accepted"\n```',
      "~~~\nStatus: Active\n~~~",
      '   ```ts\n   status: "accepted"\n   ```',
      "Status codes are returned on every response.",
      "The endpoint reports\nstatus and health over SSE.",
      "- Status updates arrive over SSE.",
    ]) {
      expect(hasStatusLine(`${readme}\n${safe}\n`)).toBe(false)
    }
  })

  test("uses an exact H1 and listing link", () => {
    const readme = readSdkReadme()
    expect(hasExactHeading(readme)).toBe(true)
    expect(hasExactHeading("# @defai-digital/ax-code-sdk-extra\n")).toBe(false)
    expect(hasExactHeading("# @defai-digital/ax-code-sdk\r\n")).toBe(true)

    const commentedHeading = readme.replace(/^(# @defai-digital\/ax-code-sdk[ \t]*)$/m, "<!--\n$1\n-->")
    expect(commentedHeading).not.toBe(readme)
    expect(hasExactHeading(commentedHeading)).toBe(false)
    const fencedHeading = readme.replace(/^(# @defai-digital\/ax-code-sdk[ \t]*)$/m, "\n~~~\n$1\n~~~")
    expect(fencedHeading).not.toBe(readme)
    expect(hasExactHeading(fencedHeading)).toBe(false)

    expect(hasListingLink(readme)).toBe(true)
    const listingLinkRe =
      /(\[[^\]]+\]\(https:\/\/github\.com\/orgs\/defai-digital\/packages\/npm\/package\/ax-code-sdk\))/
    const commentedLink = readme.replace(listingLinkRe, "<!--\n$1\n-->")
    expect(commentedLink).not.toBe(readme)
    expect(hasListingLink(commentedLink)).toBe(false)
    const fencedLink = readme.replace(listingLinkRe, "\n~~~\n$1\n~~~\n")
    expect(fencedLink).not.toBe(readme)
    expect(hasListingLink(fencedLink)).toBe(false)

    // Put the link mid-line after "See " so the fenced mutation still needs its
    // own leading newline to hide the link, independent of the surrounding
    // prose or link label.
    const reflowedListing = readme.replace(listingLinkRe, "\nSee $1")
    expect(reflowedListing).not.toBe(readme)
    expect(hasListingLink(reflowedListing)).toBe(true)
    const reflowedCommentedLink = reflowedListing.replace(listingLinkRe, "<!--\n$1\n-->")
    expect(reflowedCommentedLink).not.toBe(reflowedListing)
    expect(hasListingLink(reflowedCommentedLink)).toBe(false)
    const reflowedFencedLink = reflowedListing.replace(listingLinkRe, "\n~~~\n$1\n~~~\n")
    expect(reflowedFencedLink).not.toBe(reflowedListing)
    expect(hasListingLink(reflowedFencedLink)).toBe(false)

    const renamed = readme.replace(LISTING_LINK, LISTING_LINK.replace("ax-code-sdk)", "ax-code-sdk-legacy)"))
    expect(renamed).not.toBe(readme)
    expect(hasListingLink(renamed)).toBe(false)
    expect(hasListingLink("`https://github.com/orgs/defai-digital/packages/npm/package/ax-code-sdk`")).toBe(false)
  })

  test("README links to published assets and public wording", () => {
    const readme = readSdkReadme()
    expect(readme).toContain("```ts")
    expect(readme).toContain("](https://ax-code.app/docs-assets/sdk/examples/headless-app.ts.txt)")
    expect(readme).toContain("](https://ax-code.app/docs-assets/sdk/examples/programmatic.ts.txt)")
    expect(readme).toContain("](https://ax-code.app/docs-assets/sdk/headless.proto)")
    expect(readme).not.toMatch(/\]\(https:\/\/ax-code\.app\/docs-assets\/sdk\/examples\/[^)\s]+\.ts\)/)
    expect(readme).toContain("npm.pkg.github.com")
    expect(readme).toContain("read:packages")
  })

  test("README and SDK docs avoid stale version and access wording", () => {
    const readme = readSdkReadme()
    const sdkReadme = readFileSync(resolve(packageRoot, "../README.md"), "utf8")
    expect(readme).not.toMatch(/baseline is AX Code source v\d/)
    expect(readme).not.toContain("access to the package")
    expect(sdkReadme).not.toContain("repository access")
  })
})
