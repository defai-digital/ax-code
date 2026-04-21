import { Effect, Schema } from "effect"
import matter from "gray-matter"
import { z } from "zod"
import { NamedError } from "@ax-code/util/error"
import { Filesystem } from "../util/filesystem"

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g

  class ReadError extends Schema.TaggedErrorClass<ReadError>()("ConfigMarkdownReadError", {
    path: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

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

  const wrap = (file: string) => (err: unknown) =>
    new FrontmatterError(
      {
        path: file,
        message: `${file}: Failed to parse YAML frontmatter: ${NamedError.message(err)}`,
      },
      { cause: err },
    )

  const load = Effect.fn("ConfigMarkdown.load")((file: string, text: string) =>
    Effect.try({
      try: () => matter(text),
      catch: wrap(file),
    }).pipe(
      Effect.catch(() =>
        Effect.try({
          try: () => matter(fallbackSanitization(text)),
          catch: wrap(file),
        }),
      ),
    ),
  )

  export const parseEffect = Effect.fn("ConfigMarkdown.parse")(function* (file: string) {
    const text = yield* Effect.tryPromise({
      try: () => Filesystem.readText(file),
      catch: (err) =>
        new ReadError({
          path: file,
          message: `${file}: Failed to read markdown config`,
          cause: err,
        }),
    })
    return yield* load(file, text)
  })

  export function parse(file: string) {
    return Effect.runPromise(parseEffect(file))
  }

  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
