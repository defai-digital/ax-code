export function parseShellArgs(input: string): string[] {
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  let escape = false
  let tokenStarted = false

  const push = () => {
    if (!tokenStarted) return
    parts.push(current)
    current = ""
    tokenStarted = false
  }

  for (const char of input) {
    if (escape) {
      current += char
      tokenStarted = true
      escape = false
      continue
    }
    if (char === "\\") {
      escape = true
      tokenStarted = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = undefined
        continue
      }
      current += char
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

  if (escape) current += "\\"
  push()
  return parts
}
