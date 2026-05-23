export type LineEnding = "\n" | "\r\n"

export function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

export function detectLineEnding(text: string): LineEnding {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

export function convertToLineEnding(text: string, ending: LineEnding): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

function normalizeLineEndingsWithOffsets(text: string) {
  let normalized = ""
  const offsets = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r" && text[i + 1] === "\n") {
      normalized += "\n"
      i++
      offsets.push(i + 1)
      continue
    }
    normalized += text[i]!
    offsets.push(i + 1)
  }
  return { normalized, offsets }
}

export function spliceNormalizedReplacement(input: {
  original: string
  normalizedResult: string
  replacementEnding: LineEnding
}) {
  const { original, normalizedResult, replacementEnding } = input
  const normalizedOriginal = normalizeLineEndingsWithOffsets(original)

  let start = 0
  while (
    start < normalizedOriginal.normalized.length &&
    start < normalizedResult.length &&
    normalizedOriginal.normalized[start] === normalizedResult[start]
  ) {
    start++
  }

  let originalEnd = normalizedOriginal.normalized.length
  let resultEnd = normalizedResult.length
  while (
    originalEnd > start &&
    resultEnd > start &&
    normalizedOriginal.normalized[originalEnd - 1] === normalizedResult[resultEnd - 1]
  ) {
    originalEnd--
    resultEnd--
  }

  const replacement = convertToLineEnding(normalizedResult.slice(start, resultEnd), replacementEnding)
  return (
    original.slice(0, normalizedOriginal.offsets[start]!) +
    replacement +
    original.slice(normalizedOriginal.offsets[originalEnd]!)
  )
}
