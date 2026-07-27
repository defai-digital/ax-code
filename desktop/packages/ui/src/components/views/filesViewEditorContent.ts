// Editor content helpers for the files view: line-ending detection, normalization,
// serialization, and the truncation limit for oversized files.
// Extracted from FilesView-impl.tsx — behavior must stay byte-identical.

export const MAX_VIEW_CHARS = 200_000

export type FileLineEnding = "\n" | "\r\n"

export const detectFileLineEnding = (content: string): FileLineEnding => {
  let crlf = 0
  let lf = 0

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) !== 10) {
      continue
    }
    if (index > 0 && content.charCodeAt(index - 1) === 13) {
      crlf += 1
    } else {
      lf += 1
    }
  }

  return crlf > lf ? "\r\n" : "\n"
}

export const normalizeEditorLineEndings = (content: string): string => content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

export const serializeEditorContent = (content: string, lineEnding: FileLineEnding): string => {
  const normalized = normalizeEditorLineEndings(content)
  return lineEnding === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized
}
