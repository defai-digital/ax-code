type AttachmentLineRange = {
  start: number
  end?: number
}

export function readToolCallText(args: { filePath?: string; offset?: number; limit?: number }) {
  return `Called the Read tool with the following input: ${JSON.stringify(args)}`
}

export function attachmentLineRange(input: { start: string | null; end: string | null }): AttachmentLineRange | undefined {
  if (input.start == null) return undefined
  const parsedStart = Number(input.start)
  if (!Number.isInteger(parsedStart) || parsedStart < 0) return undefined

  const parsedEnd = input.end != null && input.end !== "" ? Number(input.end) : undefined
  const end =
    parsedEnd !== undefined && Number.isInteger(parsedEnd) && parsedEnd >= parsedStart ? parsedEnd : undefined
  return { start: parsedStart, end }
}
