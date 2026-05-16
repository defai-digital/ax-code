export function parsePastedFilePath(input: string) {
  const withoutWrappingQuotes =
    (input.startsWith("'") && input.endsWith("'")) || (input.startsWith('"') && input.endsWith('"'))
      ? input.slice(1, -1)
      : input
  if (/^[a-zA-Z]:\\/.test(withoutWrappingQuotes) || withoutWrappingQuotes.startsWith("\\\\")) return withoutWrappingQuotes
  return withoutWrappingQuotes.replace(/\\(.)/g, "$1")
}
