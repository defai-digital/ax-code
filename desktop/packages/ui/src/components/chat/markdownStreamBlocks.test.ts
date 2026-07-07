import { describe, expect, test } from "vitest"

import { buildLiveMarkdownBlocks, type LiveMarkdownLexCache } from "./markdownStreamBlocks"

const BASE_KEY = "test-key"

const fromScratch = (text: string) => buildLiveMarkdownBlocks(text, BASE_KEY, null).blocks

const streamInChunks = (text: string, chunkSizes: number[]) => {
  const steps: string[] = []
  let offset = 0
  let sizeIndex = 0
  while (offset < text.length) {
    const size = chunkSizes[sizeIndex % chunkSizes.length] ?? 1
    offset = Math.min(text.length, offset + size)
    steps.push(text.slice(0, offset))
    sizeIndex += 1
  }
  return steps
}

const expectIncrementalMatchesScratch = (text: string, chunkSizes: number[]) => {
  let cache: LiveMarkdownLexCache | null = null
  for (const partial of streamInChunks(text, chunkSizes)) {
    const incremental = buildLiveMarkdownBlocks(partial, BASE_KEY, cache)
    cache = incremental.cache
    expect(incremental.blocks).toEqual(fromScratch(partial))
  }
}

const DOCUMENT = `# Streaming report

First paragraph with **bold**, _italics_, and \`inline code\` that keeps
growing across multiple lines before the block ends.

## Details

- first item
- second item with [a link](https://example.com)
  - nested item
- third item

1. ordered one
2. ordered two

> A blockquote that spans
> two lines.

\`\`\`ts
const value = compute()
console.log(value)
\`\`\`

| col a | col b |
| ----- | ----- |
| 1     | 2     |

Setext heading
==============

Math block:

$$
x = \\frac{1}{2}
$$

Paragraph after math with trailing text that streams to the very end.
`

describe("buildLiveMarkdownBlocks", () => {
  test("incremental lexing matches from-scratch lexing at every append step", () => {
    for (const chunkSizes of [[1], [3], [7, 2, 11], [64], [1, 40]]) {
      expectIncrementalMatchesScratch(DOCUMENT, chunkSizes)
    }
  })

  test("open code fence stays a single live block until it closes", () => {
    const steps = ["```js\n", "```js\nconst a = 1\n", "```js\nconst a = 1\n```", "```js\nconst a = 1\n```\n\nafter"]
    let cache: LiveMarkdownLexCache | null = null
    for (const partial of steps) {
      const incremental = buildLiveMarkdownBlocks(partial, BASE_KEY, cache)
      cache = incremental.cache
      expect(incremental.blocks).toEqual(fromScratch(partial))
    }
    const final = buildLiveMarkdownBlocks(steps[steps.length - 1] ?? "", BASE_KEY, cache)
    expect(final.blocks.at(-1)?.raw).toBe("after")
    expect(final.blocks.at(-1)?.mode).toBe("live")
    expect(final.blocks.at(-2)?.mode).toBe("full")
  })

  test("setext heading forming after a completed paragraph matches scratch", () => {
    expectIncrementalMatchesScratch("done paragraph\n\nheading text\n=====\n\ntail", [2])
  })

  test("reference definitions collapse to a single live block", () => {
    const text = "see [ref]\n\n[ref]: https://example.com\n\nmore text"
    expectIncrementalMatchesScratch(text, [4])
    const { blocks } = buildLiveMarkdownBlocks(text, BASE_KEY, null)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.mode).toBe("live")
  })

  test("non-append rewrites reset the cache instead of reusing a stale prefix", () => {
    const first = buildLiveMarkdownBlocks("alpha\n\nbeta gamma", BASE_KEY, null)
    const rewritten = "totally different\n\ncontent here"
    const second = buildLiveMarkdownBlocks(rewritten, BASE_KEY, first.cache)
    expect(second.blocks).toEqual(fromScratch(rewritten))
  })

  test("finalized blocks are reused by reference across ticks", () => {
    const first = buildLiveMarkdownBlocks("first block\n\nsecond block", BASE_KEY, null)
    const second = buildLiveMarkdownBlocks("first block\n\nsecond block grows", BASE_KEY, first.cache)
    expect(second.blocks[0]).toBe(first.blocks[0])
  })

  test("whitespace-only text yields a single live block", () => {
    const { blocks } = buildLiveMarkdownBlocks("\n\n", BASE_KEY, null)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.mode).toBe("live")
  })
})
