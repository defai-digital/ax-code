import matter from "gray-matter"
import { z } from "zod"
import { NamedError } from "@ax-code/util/error"
import { Filesystem } from "../util/filesystem"

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g

  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  // other coding agents like claude code allow invalid yaml in their
  // frontmatter, we need to fallback to a more permissive parser for those cases
  export function fallbackSanitization(content: string): string {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return content

    const frontmatter = match[1]
    const lines = frontmatter.split(/\r?\n/)
    const result: string[] = []

    for (const line of lines) {
      // skip comments and empty lines
      if (line.trim().startsWith("#") || line.trim() === "") {
        result.push(line)
        continue
      }

      // skip lines that are continuations (indented)
      if (line.match(/^\s+/)) {
        result.push(line)
        continue
      }

      // match key: value pattern
      const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
      if (!kvMatch) {
        result.push(line)
        continue
      }

      const key = kvMatch[1]
      const value = kvMatch[2].trim()

      // skip if value is empty, already quoted, or uses block scalar
      if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) {
        result.push(line)
        continue
      }

      // if value contains a colon, convert to block scalar
      if (value.includes(":")) {
        result.push(`${key}: |-`)
        result.push(`  ${value}`)
        continue
      }

      result.push(line)
    }

    const processed = result.join("\n")
    return content.replace(frontmatter, () => processed)
  }

  // Strict limits to prevent YAML DoS (quadratic alias/merge behavior in
  // js-yaml 3.x via gray-matter). AX Code only needs simple key/value
  // frontmatter for command/agent/mode/skill metadata, so we cap the
  // frontmatter size and reject alias/merge-key syntax outright. See #251.
  const MAX_FRONTMATTER_BYTES = 256 * 1024
  const MAX_FRONTMATTER_LINES = 4000
  // Matches YAML anchors (&anchor), aliases (*alias), and merge keys (<<:).
  // Anchor/alias names must start with a letter or underscore and contain only
  // word characters and hyphens, so glob patterns like `**/*.css` are not
  // false-positive matches.
  const YAML_ALIAS_PATTERN = /(^|\s)[&*][a-zA-Z_][\w-]*|^<<:/m

  function rejectDangerousFrontmatter(file: string, frontmatter: string): InstanceType<typeof FrontmatterError> | null {
    if (Buffer.byteLength(frontmatter, "utf8") > MAX_FRONTMATTER_BYTES) {
      return new FrontmatterError({ path: file, message: `${file}: Frontmatter exceeds maximum size limit` })
    }
    if (frontmatter.split(/\r?\n/).length > MAX_FRONTMATTER_LINES) {
      return new FrontmatterError({ path: file, message: `${file}: Frontmatter exceeds maximum line limit` })
    }
    if (YAML_ALIAS_PATTERN.test(frontmatter)) {
      return new FrontmatterError({
        path: file,
        message: `${file}: YAML anchors, aliases, and merge keys are not supported in frontmatter`,
      })
    }
    return null
  }

  const wrap = (file: string) => (err: unknown) =>
    new FrontmatterError(
      {
        path: file,
        message: `${file}: Failed to parse YAML frontmatter: ${NamedError.message(err)}`,
      },
      { cause: err },
    )

  function extractFrontmatter(text: string): string | null {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    return match ? match[1] : null
  }

  async function load(file: string, text: string) {
    // Reject oversized or alias-heavy frontmatter before handing it to the
    // YAML parser, which is vulnerable to quadratic alias expansion (#251).
    const frontmatter = extractFrontmatter(text)
    if (frontmatter) {
      const rejection = rejectDangerousFrontmatter(file, frontmatter)
      if (rejection) throw rejection
    }
    try {
      return matter(text)
    } catch {
      try {
        return matter(fallbackSanitization(text))
      } catch (err) {
        throw wrap(file)(err)
      }
    }
  }

  export async function parse(file: string) {
    const text = await Filesystem.readText(file).catch((err) => {
      throw new FrontmatterError(
        {
          path: file,
          message: `${file}: Failed to read markdown config: ${NamedError.message(err)}`,
        },
        { cause: err },
      )
    })
    return load(file, text)
  }

  export function parseText(location: string, content: string) {
    return load(location, content)
  }

  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
