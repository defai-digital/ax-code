import { expect, test } from "vitest"
import { parseMarkdown, renderMarkdown } from "../src/markdown.js"
import type { MarkdownLink } from "../src/markdown.js"

class FakeEvent {
  defaultPrevented = false

  constructor(readonly key?: string) {}

  preventDefault(): void {
    this.defaultPrevented = true
  }
}

class FakeNode {
  readonly children: FakeNode[] = []

  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes)
  }

  get textContent(): string {
    return this.children.map((child) => child.textContent).join("")
  }

  set textContent(value: string) {
    this.children.length = 0
    this.children.push(new FakeText(value))
  }
}

class FakeText extends FakeNode {
  constructor(private value: string) {
    super()
  }

  override get textContent(): string {
    return this.value
  }

  override set textContent(value: string) {
    this.value = value
  }
}

class FakeElement extends FakeNode {
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>()
  className = ""
  id = ""

  constructor(readonly tagName: string) {
    super()
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | undefined {
    if (name === "class") return this.className || undefined
    if (name === "id") return this.id || undefined
    return this.attributes.get(name)
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatch(type: string, event = new FakeEvent()): FakeEvent {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
}

class FakeFragment extends FakeNode {}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toLowerCase())
  }

  createTextNode(text: string): FakeText {
    return new FakeText(text)
  }

  createDocumentFragment(): FakeFragment {
    return new FakeFragment()
  }
}

function elements(root: FakeNode, tagName?: string): FakeElement[] {
  const matches: FakeElement[] = []
  for (const child of root.children) {
    if (child instanceof FakeElement) {
      if (!tagName || child.tagName === tagName) matches.push(child)
      matches.push(...elements(child, tagName))
    }
  }
  return matches
}

function byClass(root: FakeNode, className: string): FakeElement[] {
  return elements(root).filter((element) => element.className.split(/\s+/).includes(className))
}

function render(
  source: string,
  options: {
    pagePath?: string
    pages?: ReadonlySet<string>
    sources?: ReadonlySet<string>
    activated?: MarkdownLink[]
  } = {},
): FakeFragment {
  const pages = options.pages ?? new Set<string>()
  const sources = options.sources ?? new Set<string>()
  const activated = options.activated ?? []
  const document = new FakeDocument()
  return renderMarkdown(document as unknown as Document, parseMarkdown(source).blocks, {
    pagePath: options.pagePath ?? "guide.md",
    isPage: (path) => pages.has(path),
    isSource: (path) => sources.has(path),
    onLink: (link) => activated.push(link),
  }) as unknown as FakeFragment
}

test("parses every supported block and inline form", () => {
  const result = parseMarkdown(`# Main

Text with \`src/a.ts\`, **bold**, *star*, _underscore_, and [a link](other.md).

- first
  - nested
- second

1. one
2. two

> quoted **text**

| Name | Value |
| --- | --- |
| **bold** | \`code\` |

---

\`\`\`ts
const value = "<script>"
\`\`\``)

  expect(result.truncated).toBe(false)
  expect(result.blocks.map((block) => block.type)).toEqual([
    "heading",
    "paragraph",
    "list",
    "list",
    "blockquote",
    "table",
    "thematic-break",
    "code",
  ])
  expect(result.headings).toEqual([{ level: 1, text: "Main", slug: "main" }])

  const paragraph = result.blocks[1]
  expect(paragraph).toMatchObject({
    type: "paragraph",
    inlines: [
      { type: "text", text: "Text with " },
      { type: "code", text: "src/a.ts" },
      { type: "text", text: ", " },
      { type: "strong", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: ", " },
      { type: "emphasis", children: [{ type: "text", text: "star" }] },
      { type: "text", text: ", " },
      { type: "emphasis", children: [{ type: "text", text: "underscore" }] },
      { type: "text", text: ", and " },
      { type: "link", href: "other.md", children: [{ type: "text", text: "a link" }] },
      { type: "text", text: "." },
    ],
  })

  const unordered = result.blocks[2]
  expect(unordered).toMatchObject({ type: "list", ordered: false })
  if (unordered?.type !== "list") throw new Error("expected unordered list")
  expect(unordered.items).toHaveLength(2)
  expect(unordered.items[0]?.blocks.map((block) => block.type)).toEqual(["paragraph", "list"])
  const nested = unordered.items[0]?.blocks[1]
  expect(nested).toMatchObject({ type: "list", ordered: false, items: [{ blocks: [{ type: "paragraph" }] }] })

  const ordered = result.blocks[3]
  expect(ordered).toMatchObject({ type: "list", ordered: true })
  if (ordered?.type !== "list") throw new Error("expected ordered list")
  expect(ordered.items).toHaveLength(2)

  expect(result.blocks[4]).toMatchObject({
    type: "blockquote",
    blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "quoted " }, { type: "strong" }] }],
  })
  expect(result.blocks[5]).toMatchObject({
    type: "table",
    header: [[{ type: "text", text: "Name" }], [{ type: "text", text: "Value" }]],
    rows: [[[{ type: "strong" }], [{ type: "code", text: "code" }]]],
  })
  expect(result.blocks[7]).toEqual({ type: "code", language: "ts", text: 'const value = "<script>"' })
})

test("normalizes and deduplicates heading slugs", () => {
  const result = parseMarkdown("# Hello, World!\n## Hello World 2\n## **Hello** World\n### !!!\n#### !!!")
  expect(result.headings).toEqual([
    { level: 1, text: "Hello, World!", slug: "hello-world" },
    { level: 2, text: "Hello World 2", slug: "hello-world-2" },
    { level: 2, text: "Hello World", slug: "hello-world-3" },
    { level: 3, text: "!!!", slug: "section" },
    { level: 4, text: "!!!", slug: "section-2" },
  ])
})

test("renders semantic elements, heading ids, code language, and table inline content", () => {
  const fragment = render(`# **Title**

Paragraph with *emphasis*.

| A | B |
| --- | --- |
| **one** | \`two\` |

> quote

- item

---

\`\`\`json
{"safe":"<tag>"}
\`\`\``)

  expect(elements(fragment, "h1")[0]?.id).toBe("axwv-h-title")
  expect(elements(fragment, "strong").map((element) => element.textContent)).toEqual(["Title", "one"])
  expect(elements(fragment, "em")[0]?.textContent).toBe("emphasis")
  expect(elements(fragment, "table")).toHaveLength(1)
  expect(elements(fragment, "thead")).toHaveLength(1)
  expect(elements(fragment, "tbody")).toHaveLength(1)
  expect(elements(fragment, "th").map((element) => element.textContent)).toEqual(["A", "B"])
  expect(elements(fragment, "td").map((element) => element.textContent)).toEqual(["one", "two"])
  expect(elements(fragment, "blockquote")[0]?.textContent).toBe("quote")
  expect(elements(fragment, "ul")[0]?.textContent).toBe("item")
  expect(elements(fragment, "hr")).toHaveLength(1)
  const blockCode = elements(fragment, "pre")[0]?.children[0]
  expect(blockCode).toBeInstanceOf(FakeElement)
  expect((blockCode as FakeElement).getAttribute("data-lang")).toBe("json")
  expect(blockCode?.textContent).toBe('{"safe":"<tag>"}')
})

test("classifies links, resolves safe paths, and activates internal links", () => {
  const activated: MarkdownLink[] = []
  const fragment = render(
    `[page](../other.md?view=1#part)

[resolved source](../../../src/a.ts#L4) [written source](src/root.ts) [site](https://example.com/a?q=1#x)

\`src/root.ts\``,
    {
      pagePath: "modules/ax-code/src/cli.md",
      pages: new Set(["modules/ax-code/other.md"]),
      sources: new Set(["src/a.ts", "src/root.ts"]),
      activated,
    },
  )

  const page = byClass(fragment, "md-page")[0]!
  expect(page.getAttribute("href")).toBe("#")
  expect(page.textContent).toBe("page")

  const sources = byClass(fragment, "md-source")
  expect(sources.map((source) => source.textContent)).toEqual(["resolved source", "written source", "src/root.ts"])
  expect(sources[2]?.tagName).toBe("code")
  expect(sources[2]?.getAttribute("role")).toBe("link")
  expect(sources[2]?.getAttribute("tabindex")).toBe("0")

  const external = byClass(fragment, "md-external")[0]!
  expect(external.getAttribute("href")).toBe("https://example.com/a?q=1#x")
  expect(external.getAttribute("target")).toBe("_blank")
  expect(external.getAttribute("rel")).toBe("noopener noreferrer")

  const click = page.dispatch("click")
  const sourceEnter = sources[0]!.dispatch("keydown", new FakeEvent("Enter"))
  const ignoredKey = sources[1]!.dispatch("keydown", new FakeEvent(" "))
  const codeClick = sources[2]!.dispatch("click")
  expect(click.defaultPrevented).toBe(true)
  expect(sourceEnter.defaultPrevented).toBe(true)
  expect(ignoredKey.defaultPrevented).toBe(false)
  expect(codeClick.defaultPrevented).toBe(true)
  expect(activated).toEqual([
    { kind: "page", target: "modules/ax-code/other.md" },
    { kind: "source", target: "src/a.ts" },
    { kind: "source", target: "src/root.ts" },
  ])
})

test("renders hostile HTML and unsafe or unknown links as inert text", () => {
  const activated: MarkdownLink[] = []
  const fragment = render(
    `<script>alert("x")</script>

<img src=x onerror=alert(1)>

[js](javascript:alert(1)) [data](data:text/html,bad) [mail](mailto:a@example.com) [escape](../../etc/passwd) [unknown](other.bin)

\`<img onerror=alert(1)>\`

\`\`\`html
<script>still text</script>
\`\`\``,
    { activated, sources: new Set(["src/known.ts", "../../etc/passwd"]) },
  )

  expect(elements(fragment, "script")).toHaveLength(0)
  expect(elements(fragment, "img")).toHaveLength(0)
  expect(elements(fragment, "a")).toHaveLength(0)
  expect(elements(fragment, "span").map((span) => span.textContent)).toEqual([
    "js",
    "data",
    "mail",
    "escape",
    "unknown",
  ])
  expect(fragment.textContent).toContain('<script>alert("x")</script>')
  expect(fragment.textContent).toContain("<img src=x onerror=alert(1)>")
  expect(fragment.textContent).toContain("<script>still text</script>")
  expect(activated).toEqual([])
  for (const element of elements(fragment)) {
    expect([...element.attributes.keys()].some((name) => name.toLowerCase().startsWith("on"))).toBe(false)
    expect(element.attributes.has("style")).toBe(false)
  }
})

test("drops block nesting deeper than eight levels", () => {
  const result = parseMarkdown(`${"> ".repeat(10)}too deep`)
  let blocks = result.blocks
  let quoteCount = 0
  while (blocks[0]?.type === "blockquote") {
    quoteCount++
    blocks = blocks[0].blocks
  }
  expect(quoteCount).toBe(8)
  expect(blocks).toEqual([])
  expect(result.truncated).toBe(false)
})

test("accepts nested lists indented by more than two spaces", () => {
  const result = parseMarkdown("- root\n    1. child\n        - grandchild")
  const root = result.blocks[0]
  if (root?.type !== "list") throw new Error("expected root list")
  const child = root.items[0]?.blocks.find((block) => block.type === "list")
  expect(child).toMatchObject({ type: "list", ordered: true })
  if (child?.type !== "list") throw new Error("expected child list")
  expect(child.items[0]?.blocks.find((block) => block.type === "list")).toMatchObject({
    type: "list",
    ordered: false,
  })
})

test("caps the total block count and reports only actual truncation", () => {
  const exactlyAtLimit = parseMarkdown(Array.from({ length: 4_000 }, (_, index) => `paragraph ${index}`).join("\n\n"))
  expect(exactlyAtLimit.blocks).toHaveLength(4_000)
  expect(exactlyAtLimit.truncated).toBe(false)

  const overLimit = parseMarkdown(Array.from({ length: 4_001 }, (_, index) => `paragraph ${index}`).join("\n\n"))
  expect(overLimit.blocks).toHaveLength(4_000)
  expect(overLimit.truncated).toBe(true)
})

test.each([
  ["asterisks", "*".repeat(50_000)],
  ["brackets", "[".repeat(50_000)],
])("parses adversarial %s in under 200 ms", (_name, source) => {
  const started = performance.now()
  const result = parseMarkdown(source)
  const elapsed = performance.now() - started
  expect(result.blocks).toHaveLength(1)
  expect(elapsed).toBeLessThan(200)
})

test("keeps snake_case literal, numbers ordered lists, and accepts uppercase https", () => {
  const parsed = parseMarkdown("Call read_source_no_follow and _emphasis_ here.\n\n5. five\n6. six\n\n[x](HTTPS://example.com)")
  const paragraph = parsed.blocks[0]!
  expect(paragraph.type).toBe("paragraph")
  if (paragraph.type !== "paragraph") return
  expect(paragraph.inlines[0]).toEqual({ type: "text", text: "Call read_source_no_follow and " })
  expect(paragraph.inlines[1]).toMatchObject({ type: "emphasis" })
  const list = parsed.blocks[1]!
  expect(list).toMatchObject({ type: "list", ordered: true, start: 5 })
  const fragment = render("5. five\n6. six\n\n[x](HTTPS://example.com)")
  expect(elements(fragment, "ol")[0]!.getAttribute("start")).toBe("5")
  expect(byClass(fragment, "md-external")).toHaveLength(1)
})

test("never hands a traversal path to onLink and counts table rows and list items toward the budget", () => {
  const activated: MarkdownLink[] = []
  const fragment = render("[x](../../etc/passwd)", {
    pagePath: "a/b/c.md",
    sources: new Set(["../../etc/passwd"]),
    activated,
  })
  expect(byClass(fragment, "md-source")).toHaveLength(0)
  const table = parseMarkdown(`| a |\n| --- |\n${"| x |\n".repeat(6000)}`)
  expect(table.truncated).toBe(true)
  const list = parseMarkdown("- \n".repeat(6000))
  expect(list.truncated).toBe(true)
})
