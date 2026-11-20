import { Lexer, type MarkedToken } from "marked"

export interface ParseState {
  content: string
  tokens: MarkedToken[]
  stableTokenCount?: number
}

// Reference defs can hide inside blockquotes and list items, and a reference
// anywhere in the document may resolve against them. A sliced lex cannot see
// defs outside its slice, so any def forces a full re-lex.
function containsDef(tokens: MarkedToken[]): boolean {
  for (const token of tokens) {
    if (token.type === "def") return true
    if ("tokens" in token && token.tokens && containsDef(token.tokens as MarkedToken[])) return true
    if ("items" in token && token.items) {
      for (const item of token.items) {
        if ("tokens" in item && item.tokens && containsDef(item.tokens as MarkedToken[])) return true
      }
    }
  }
  return false
}

function lexFullState(content: string, trailingUnstable: number): ParseState {
  try {
    const tokens = Lexer.lex(content, { gfm: true }) as MarkedToken[]
    return { content, tokens, stableTokenCount: Math.max(0, tokens.length - trailingUnstable) }
  } catch {
    return { content, tokens: [], stableTokenCount: 0 }
  }
}

/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 * Compares token.raw at each offset - matching tokens keep same object reference.
 */
export function parseMarkdownIncremental(
  newContent: string,
  prevState: ParseState | null,
  trailingUnstable: number = 2,
): ParseState {
  if (!prevState || prevState.tokens.length === 0) {
    return lexFullState(newContent, trailingUnstable)
  }

  // Find how many tokens from start are unchanged
  let offset = 0
  let reuseCount = 0

  for (const token of prevState.tokens) {
    const tokenLength = token.raw.length
    if (offset + tokenLength <= newContent.length && newContent.startsWith(token.raw, offset)) {
      reuseCount++
      offset += tokenLength
    } else {
      break
    }
  }

  // Keep last N tokens unstable (e.g. "# Hello" might become "# Hello World")
  reuseCount = Math.max(0, reuseCount - trailingUnstable)

  offset = 0
  for (let i = 0; i < reuseCount; i++) {
    offset += prevState.tokens[i].raw.length
  }

  const stableTokens = prevState.tokens.slice(0, reuseCount)
  const remainingContent = newContent.slice(offset)

  // Deleting or editing a def changes how references in the reused prefix
  // resolve, even when the prefix bytes themselves are unchanged.
  if (containsDef(prevState.tokens)) {
    return lexFullState(newContent, trailingUnstable)
  }

  if (!remainingContent) {
    return {
      content: newContent,
      tokens: stableTokens,
      stableTokenCount: stableTokens.length,
    }
  }

  try {
    const newTokens = Lexer.lex(remainingContent, { gfm: true }) as MarkedToken[]
    // A sliced lex cannot resolve references against defs in the stable prefix or appended tail.
    if (containsDef(newTokens)) {
      return lexFullState(newContent, trailingUnstable)
    }
    return {
      content: newContent,
      tokens: [...stableTokens, ...newTokens],
      stableTokenCount: trailingUnstable === 0 ? stableTokens.length + newTokens.length : stableTokens.length,
    }
  } catch {
    try {
      const fullTokens = Lexer.lex(newContent, { gfm: true }) as MarkedToken[]
      return { content: newContent, tokens: fullTokens, stableTokenCount: 0 }
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }
}
