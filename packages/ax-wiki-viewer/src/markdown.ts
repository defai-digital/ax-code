export type MarkdownLink =
  | { kind: "page"; target: string }
  | { kind: "source"; target: string }
  | { kind: "external"; href: string }

type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "emphasis"; children: MarkdownInline[] }
  | { type: "link"; href: string; children: MarkdownInline[] }

type MarkdownListItem = { blocks: MarkdownBlock[] }

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string; slug: string; inlines: MarkdownInline[] }
  | { type: "paragraph"; inlines: MarkdownInline[] }
  | { type: "code"; language: string; text: string }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { type: "blockquote"; blocks: MarkdownBlock[] }
  | { type: "table"; header: MarkdownInline[][]; rows: MarkdownInline[][][] }
  | { type: "thematic-break" }

export type MarkdownHeading = { level: number; text: string; slug: string }

const MAX_BLOCKS = 4_000
const MAX_BLOCK_DEPTH = 8
const MAX_INLINE_DEPTH = 16

type ParseState = {
  blockCount: number
  truncated: boolean
  headings: MarkdownHeading[]
  slugCounts: Map<string, number>
  usedSlugs: Set<string>
}

type ListMarker = {
  indent: number
  ordered: boolean
  number: number
  content: string
}

function isWordChar(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character)
}

function pushText(inlines: MarkdownInline[], text: string): void {
  if (!text) return
  const previous = inlines[inlines.length - 1]
  if (previous?.type === "text") previous.text += text
  else inlines.push({ type: "text", text })
}

function parseInlines(source: string, depth = 0): MarkdownInline[] {
  if (!source) return []
  if (depth >= MAX_INLINE_DEPTH) return [{ type: "text", text: source }]

  const result: MarkdownInline[] = []
  let plainStart = 0
  let index = 0
  let linksExhausted = false
  let strongExhausted = false
  let starExhausted = false
  let underscoreExhausted = false
  let codeExhausted = false

  const flush = (end: number): void => {
    pushText(result, source.slice(plainStart, end))
  }

  while (index < source.length) {
    const character = source[index]!

    if (character === "`" && !codeExhausted) {
      const close = source.indexOf("`", index + 1)
      if (close < 0) {
        codeExhausted = true
        index++
        continue
      }
      flush(index)
      result.push({ type: "code", text: source.slice(index + 1, close) })
      index = close + 1
      plainStart = index
      continue
    }

    if (character === "[" && !linksExhausted) {
      const labelEnd = source.indexOf("](", index + 1)
      if (labelEnd < 0) {
        linksExhausted = true
        index++
        continue
      }
      const hrefEnd = source.indexOf(")", labelEnd + 2)
      if (hrefEnd < 0) {
        linksExhausted = true
        index++
        continue
      }
      flush(index)
      result.push({
        type: "link",
        href: source.slice(labelEnd + 2, hrefEnd).trim(),
        children: parseInlines(source.slice(index + 1, labelEnd), depth + 1),
      })
      index = hrefEnd + 1
      plainStart = index
      continue
    }

    if (character === "*" && source[index + 1] === "*" && !strongExhausted) {
      const close = source.indexOf("**", index + 2)
      if (close < 0) {
        strongExhausted = true
        index += 2
        continue
      }
      if (close === index + 2) {
        index += 2
        continue
      }
      flush(index)
      result.push({
        type: "strong",
        children: parseInlines(source.slice(index + 2, close), depth + 1),
      })
      index = close + 2
      plainStart = index
      continue
    }

    if (character === "*" && !starExhausted) {
      const close = source.indexOf("*", index + 1)
      if (close < 0) {
        starExhausted = true
        index++
        continue
      }
      if (close === index + 1) {
        index += 2
        continue
      }
      flush(index)
      result.push({
        type: "emphasis",
        children: parseInlines(source.slice(index + 1, close), depth + 1),
      })
      index = close + 1
      plainStart = index
      continue
    }

    if (character === "_" && !underscoreExhausted && !isWordChar(source[index - 1])) {
      let close = source.indexOf("_", index + 1)
      while (close >= 0 && isWordChar(source[close + 1])) close = source.indexOf("_", close + 1)
      if (close < 0) {
        underscoreExhausted = true
        index++
        continue
      }
      if (close === index + 1) {
        index += 2
        continue
      }
      flush(index)
      result.push({
        type: "emphasis",
        children: parseInlines(source.slice(index + 1, close), depth + 1),
      })
      index = close + 1
      plainStart = index
      continue
    }

    index++
  }

  flush(source.length)
  return result
}

function inlineText(inlines: readonly MarkdownInline[]): string {
  let text = ""
  for (const inline of inlines) {
    if (inline.type === "text" || inline.type === "code") text += inline.text
    else text += inlineText(inline.children)
  }
  return text
}

function slugBase(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "section"
}

function uniqueSlug(text: string, state: ParseState): string {
  const base = slugBase(text)
  let count = (state.slugCounts.get(base) ?? 0) + 1
  let slug = count === 1 ? base : `${base}-${count}`
  while (state.usedSlugs.has(slug)) {
    count++
    slug = `${base}-${count}`
  }
  state.slugCounts.set(base, count)
  state.usedSlugs.add(slug)
  return slug
}

function reserveBlock(state: ParseState): boolean {
  if (state.blockCount >= MAX_BLOCKS) {
    state.truncated = true
    return false
  }
  state.blockCount++
  return true
}

function leadingSpaces(line: string): number {
  let count = 0
  while (line[count] === " ") count++
  return count
}

function listMarker(line: string): ListMarker | undefined {
  const indent = leadingSpaces(line)
  const rest = line.slice(indent)
  if (rest.startsWith("- ")) return { indent, ordered: false, number: 1, content: rest.slice(2) }

  let digitEnd = 0
  while (digitEnd < rest.length && rest.charCodeAt(digitEnd) >= 48 && rest.charCodeAt(digitEnd) <= 57) digitEnd++
  if (digitEnd > 0 && rest[digitEnd] === "." && rest[digitEnd + 1] === " ") {
    return { indent, ordered: true, number: Math.min(Number(rest.slice(0, digitEnd)), 1_000_000), content: rest.slice(digitEnd + 2) }
  }
  return undefined
}

function headingMatch(line: string): { level: number; content: string } | undefined {
  let level = 0
  while (level < 6 && line[level] === "#") level++
  if (level === 0 || line[level] !== " ") return undefined
  return {
    level,
    content: line
      .slice(level + 1)
      .replace(/[ \t]+#+[ \t]*$/, "")
      .trim(),
  }
}

function fenceLanguage(line: string): string | undefined {
  if (!line.startsWith("```")) return undefined
  return line.slice(3).trim().split(/\s+/, 1)[0] ?? ""
}

function splitTableRow(line: string): string[] {
  let source = line.trim()
  if (source.startsWith("|")) source = source.slice(1)
  if (source.endsWith("|")) source = source.slice(0, -1)

  const cells: string[] = []
  let cell = ""
  let inCode = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!
    if (character === "\\" && source[index + 1] === "|") {
      cell += "|"
      index++
      continue
    }
    if (character === "`") inCode = !inCode
    if (character === "|" && !inCode) {
      cells.push(cell.trim())
      cell = ""
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isBlockStart(lines: readonly string[], index: number): boolean {
  const line = lines[index]!
  if (!line.trim()) return true
  if (headingMatch(line) || fenceLanguage(line) !== undefined || line.trim() === "---") return true
  const marker = listMarker(line)
  if (line.startsWith(">") || (marker && marker.indent !== 1)) return true
  return line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1]!)
}

function normalizeListBodyLine(line: string, parentIndent: number): string {
  if (!line) return ""
  const indent = leadingSpaces(line)
  const required = parentIndent + 2
  if (indent < required) return line.slice(Math.min(indent, parentIndent))
  return line.slice(required)
}

function parseList(
  lines: readonly string[],
  start: number,
  depth: number,
  state: ParseState,
): { block?: MarkdownBlock; next: number } {
  const first = listMarker(lines[start]!)!
  const items: MarkdownListItem[] = []
  let index = start

  while (index < lines.length && !state.truncated) {
    const marker = listMarker(lines[index]!)
    if (!marker || marker.indent !== first.indent || marker.ordered !== first.ordered) break
    if (!reserveBlock(state)) break

    const body = [marker.content]
    index++
    while (index < lines.length) {
      const line = lines[index]!
      const nextMarker = listMarker(line)
      if (nextMarker && nextMarker.indent === first.indent) break
      if (line.trim() && leadingSpaces(line) <= first.indent) break
      body.push(normalizeListBodyLine(line, first.indent))
      index++
    }
    while (body.length > 1 && !body[body.length - 1]!.trim()) body.pop()
    items.push({ blocks: parseBlocks(body, depth + 1, state) })
  }

  return { block: { type: "list", ordered: first.ordered, start: first.number, items }, next: index }
}

function skipList(lines: readonly string[], start: number): number {
  const first = listMarker(lines[start]!)!
  let index = start + 1
  while (index < lines.length) {
    const line = lines[index]!
    const marker = listMarker(line)
    if (marker?.indent === first.indent) {
      if (marker.ordered !== first.ordered) break
      index++
      continue
    }
    if (line.trim() && leadingSpaces(line) <= first.indent) break
    index++
  }
  return index
}

function parseBlocks(lines: readonly string[], depth: number, state: ParseState): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length && !state.truncated) {
    const line = lines[index]!
    if (!line.trim()) {
      index++
      continue
    }

    const language = fenceLanguage(line)
    if (language !== undefined) {
      let end = index + 1
      while (end < lines.length && lines[end]!.trim() !== "```") end++
      if (!reserveBlock(state)) break
      blocks.push({ type: "code", language, text: lines.slice(index + 1, end).join("\n") })
      index = end < lines.length ? end + 1 : end
      continue
    }

    const heading = headingMatch(line)
    if (heading) {
      if (!reserveBlock(state)) break
      const inlines = parseInlines(heading.content)
      const text = inlineText(inlines)
      const slug = uniqueSlug(text, state)
      blocks.push({ type: "heading", level: heading.level, text, slug, inlines })
      state.headings.push({ level: heading.level, text, slug })
      index++
      continue
    }

    if (line.trim() === "---") {
      if (!reserveBlock(state)) break
      blocks.push({ type: "thematic-break" })
      index++
      continue
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1]!)) {
      const headerCells = splitTableRow(line)
      const rows: MarkdownInline[][][] = []
      let end = index + 2
      while (end < lines.length && lines[end]!.trim() && lines[end]!.includes("|")) {
        // Rows count toward the block budget so a huge table cannot bypass it.
        if (!reserveBlock(state)) break
        const cells = splitTableRow(lines[end]!)
        while (cells.length < headerCells.length) cells.push("")
        rows.push(cells.slice(0, headerCells.length).map((cell) => parseInlines(cell)))
        end++
      }
      if (!reserveBlock(state)) break
      blocks.push({
        type: "table",
        header: headerCells.map((cell) => parseInlines(cell)),
        rows,
      })
      index = end
      continue
    }

    if (line.startsWith(">")) {
      let end = index
      const quoted: string[] = []
      while (end < lines.length && lines[end]!.startsWith(">")) {
        const quotedLine = lines[end]!.slice(1)
        quoted.push(quotedLine.startsWith(" ") ? quotedLine.slice(1) : quotedLine)
        end++
      }
      if (depth >= MAX_BLOCK_DEPTH) {
        index = end
        continue
      }
      if (!reserveBlock(state)) break
      blocks.push({ type: "blockquote", blocks: parseBlocks(quoted, depth + 1, state) })
      index = end
      continue
    }

    const marker = listMarker(line)
    if (marker && marker.indent !== 1) {
      if (depth >= MAX_BLOCK_DEPTH) {
        index = skipList(lines, index)
        continue
      }
      if (!reserveBlock(state)) break
      const parsed = parseList(lines, index, depth, state)
      if (parsed.block) blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    let end = index + 1
    while (end < lines.length && !isBlockStart(lines, end)) end++
    if (!reserveBlock(state)) break
    blocks.push({ type: "paragraph", inlines: parseInlines(lines.slice(index, end).join("\n")) })
    index = end
  }

  return blocks
}

/** Pure parse; no DOM. Bounded to 4,000 block nodes. */
export function parseMarkdown(source: string): {
  blocks: MarkdownBlock[]
  headings: MarkdownHeading[]
  truncated: boolean
} {
  const state: ParseState = {
    blockCount: 0,
    truncated: false,
    headings: [],
    slugCounts: new Map(),
    usedSlugs: new Set(),
  }
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const blocks = parseBlocks(lines, 0, state)
  return { blocks, headings: state.headings, truncated: state.truncated }
}

type RenderOptions = {
  pagePath: string
  isPage(path: string): boolean
  isSource(path: string): boolean
  onLink(link: MarkdownLink): void
}

function cleanRelativeHref(href: string): string {
  const query = href.indexOf("?")
  const fragment = href.indexOf("#")
  let end = href.length
  if (query >= 0) end = Math.min(end, query)
  if (fragment >= 0) end = Math.min(end, fragment)
  return href.slice(0, end)
}

function resolveWikiPath(pagePath: string, href: string): string | undefined {
  const clean = cleanRelativeHref(href)
  if (!clean || clean.startsWith("/") || clean.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return undefined

  const parts = pagePath.split("/").slice(0, -1)
  if (parts.some((part) => part === "..")) return undefined
  const resolved = parts.filter((part) => part && part !== ".")
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (resolved.length === 0) return undefined
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  return resolved.length > 0 ? resolved.join("/") : undefined
}

function classifyLink(href: string, options: RenderOptions): MarkdownLink | undefined {
  if (/^(?:javascript|data|mailto):/i.test(href) || href.startsWith("//")) return undefined

  const resolved = resolveWikiPath(options.pagePath, href)
  if (resolved?.endsWith(".md") && options.isPage(resolved)) return { kind: "page", target: resolved }
  if (resolved && options.isSource(resolved)) return { kind: "source", target: resolved }

  const written = cleanRelativeHref(href)
  if (resolved && written && !written.split("/").includes("..") && options.isSource(written)) {
    return { kind: "source", target: written }
  }
  if (/^https?:\/\//i.test(href)) return { kind: "external", href }
  return undefined
}

function addActivation(element: HTMLElement, link: MarkdownLink, onLink: (link: MarkdownLink) => void): void {
  const activate = (event: Event): void => {
    event.preventDefault()
    onLink(link)
  }
  element.addEventListener("click", activate)
  element.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") activate(event)
  })
}

function renderInlines(
  doc: Document,
  host: HTMLElement,
  inlines: readonly MarkdownInline[],
  options: RenderOptions,
): void {
  for (const inline of inlines) {
    if (inline.type === "text") {
      host.append(doc.createTextNode(inline.text))
      continue
    }
    if (inline.type === "code") {
      const code = doc.createElement("code")
      code.textContent = inline.text
      if (options.isSource(inline.text)) {
        code.className = "md-source"
        code.setAttribute("role", "link")
        code.setAttribute("tabindex", "0")
        addActivation(code, { kind: "source", target: inline.text }, options.onLink)
      }
      host.append(code)
      continue
    }
    if (inline.type === "strong" || inline.type === "emphasis") {
      const element = doc.createElement(inline.type === "strong" ? "strong" : "em")
      renderInlines(doc, element, inline.children, options)
      host.append(element)
      continue
    }

    const link = classifyLink(inline.href, options)
    if (!link) {
      const span = doc.createElement("span")
      renderInlines(doc, span, inline.children, options)
      host.append(span)
      continue
    }
    const anchor = doc.createElement("a")
    if (link.kind === "external") {
      anchor.className = "md-external"
      anchor.setAttribute("href", link.href)
      anchor.setAttribute("target", "_blank")
      anchor.setAttribute("rel", "noopener noreferrer")
    } else {
      anchor.className = link.kind === "page" ? "md-page" : "md-source"
      anchor.setAttribute("href", "#")
      addActivation(anchor, link, options.onLink)
    }
    renderInlines(doc, anchor, inline.children, options)
    host.append(anchor)
  }
}

function renderBlocks(
  doc: Document,
  host: DocumentFragment | HTMLElement,
  blocks: readonly MarkdownBlock[],
  options: RenderOptions,
): void {
  for (const block of blocks) {
    if (block.type === "heading") {
      const heading = doc.createElement(`h${block.level}`)
      heading.id = `axwv-h-${block.slug}`
      renderInlines(doc, heading, block.inlines, options)
      host.append(heading)
      continue
    }
    if (block.type === "paragraph") {
      const paragraph = doc.createElement("p")
      renderInlines(doc, paragraph, block.inlines, options)
      host.append(paragraph)
      continue
    }
    if (block.type === "code") {
      const pre = doc.createElement("pre")
      const code = doc.createElement("code")
      code.textContent = block.text
      code.setAttribute("data-lang", block.language)
      pre.append(code)
      host.append(pre)
      continue
    }
    if (block.type === "thematic-break") {
      host.append(doc.createElement("hr"))
      continue
    }
    if (block.type === "blockquote") {
      const quote = doc.createElement("blockquote")
      renderBlocks(doc, quote, block.blocks, options)
      host.append(quote)
      continue
    }
    if (block.type === "list") {
      const list = doc.createElement(block.ordered ? "ol" : "ul")
      if (block.ordered && block.start !== 1) list.setAttribute("start", String(block.start))
      for (const item of block.items) {
        const listItem = doc.createElement("li")
        renderBlocks(doc, listItem, item.blocks, options)
        list.append(listItem)
      }
      host.append(list)
      continue
    }

    const table = doc.createElement("table")
    const head = doc.createElement("thead")
    const headRow = doc.createElement("tr")
    for (const cell of block.header) {
      const th = doc.createElement("th")
      renderInlines(doc, th, cell, options)
      headRow.append(th)
    }
    head.append(headRow)
    table.append(head)
    const body = doc.createElement("tbody")
    for (const row of block.rows) {
      const tableRow = doc.createElement("tr")
      for (const cell of row) {
        const td = doc.createElement("td")
        renderInlines(doc, td, cell, options)
        tableRow.append(td)
      }
      body.append(tableRow)
    }
    table.append(body)
    host.append(table)
  }
}

/** Render a parsed document without interpreting any model-written text as HTML. */
export function renderMarkdown(doc: Document, blocks: MarkdownBlock[], options: RenderOptions): DocumentFragment {
  const fragment = doc.createDocumentFragment()
  renderBlocks(doc, fragment, blocks, options)
  return fragment
}
