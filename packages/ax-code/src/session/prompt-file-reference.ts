type AttachmentLineRange = {
  start: number
  end?: number
}

export function readToolCallText(args: { filePath?: string; offset?: number; limit?: number }) {
  return `Called the Read tool with the following input: ${JSON.stringify(args)}`
}

function parseLineNumber(value: string | null): number | undefined {
  if (value == null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function attachmentLineRange(input: {
  start: string | null
  end: string | null
}): AttachmentLineRange | undefined {
  const parsedStart = parseLineNumber(input.start)
  if (parsedStart === undefined) return undefined

  const parsedEnd = parseLineNumber(input.end)
  const end = parsedEnd !== undefined && parsedEnd >= parsedStart ? parsedEnd : undefined
  return { start: parsedStart, end }
}
