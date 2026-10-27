export function parseShellArgs(input: string): string[] {
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  let tokenStarted = false

  const push = () => {
    if (!tokenStarted) return
    parts.push(current)
    current = ""
    tokenStarted = false
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quote === "'") {
      // Inside single quotes every character is literal, including
      // backslashes and double quotes.
      if (char === "'") {
        quote = undefined
        continue
      }
      current += char
      tokenStarted = true
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = undefined
        continue
      }
      if (char === "\\") {
        // Inside double quotes a backslash only escapes $, `, ", \ and
        // newline; before any other character (or at end of input) it stays
        // literal. Backslash-newline is removed entirely.
        const next = input[i + 1]
        if (next === "$" || next === "`" || next === '"' || next === "\\") {
          current += next
          i++
        } else if (next === "\n") {
          i++
        } else {
          current += "\\"
        }
        tokenStarted = true
        continue
      }
      current += char
      tokenStarted = true
      continue
    }
    if (char === "\\") {
      if (i + 1 < input.length) {
        const next = input[i + 1]
        if (next === "\n") {
          // Line continuation: both characters are removed and the token
          // continues on the next line.
          i++
          continue
        }
        current += next
        i++
        tokenStarted = true
        continue
      }
      // A trailing backslash with nothing left to escape stays literal.
      current += "\\"
      tokenStarted = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      tokenStarted = true
      continue
    }
    if (/\s/.test(char)) {
      push()
      continue
    }
    current += char
    tokenStarted = true
  }

  push()
  return parts
}
