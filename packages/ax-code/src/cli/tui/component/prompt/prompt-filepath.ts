export function parsePastedFilePath(input: string) {
  const withoutWrappingQuotes =
    input.length >= 2 &&
    ((input.startsWith("'") && input.endsWith("'")) || (input.startsWith('"') && input.endsWith('"')))
      ? input.slice(1, -1)
      : input
  // UNC paths keep their leading double backslash, which the escape decoder
  // would otherwise collapse. Drive paths need no special case: separators
  // sit before alphanumerics and survive the decoder, while escaped
  // metacharacters (spaces, parentheses) still decode.
  if (withoutWrappingQuotes.startsWith("\\\\")) return withoutWrappingQuotes
  // Shells only escape characters that need escaping; a backslash before an
  // alphanumeric or ._- is a literal path separator (Windows relative paths,
  // POSIX filenames containing backslashes), not a shell escape.
  return withoutWrappingQuotes.replace(/\\([^a-zA-Z0-9._-])/g, "$1")
}
