import { pathToFileURL } from "url"

export namespace SkillCatalog {
  export const MAX_CHARACTERS = 8000
  const MAX_DESCRIPTION_CHARACTERS = 400

  export interface Entry {
    name: string
    description: string
    location: string
    builtin?: boolean
  }

  export interface Options {
    verbose: boolean
    recommended?: Set<string>
    maxCharacters?: number
    offset?: number
    paginate?: boolean
  }

  function escape(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
      .replace(/\s+/g, " ")
      .trim()
  }

  function render(skill: Entry, opts: Options, descriptionLimit = MAX_DESCRIPTION_CHARACTERS) {
    const raw = skill.description.replace(/\s+/g, " ").trim()
    const description = escape(raw.length > descriptionLimit ? raw.slice(0, descriptionLimit - 1) + "…" : raw)
    const name = escape(skill.name)
    const recommended = opts.recommended?.has(skill.name)
    if (!opts.verbose) {
      const marker = recommended ? " (recommended - matches current files)" : ""
      return `- **${name}**: ${description}${marker}`
    }
    const location = skill.builtin
      ? `builtin://${encodeURIComponent(skill.name)}/SKILL.md`
      : pathToFileURL(skill.location).href
    return [
      recommended ? '  <skill recommended="true">' : "  <skill>",
      `    <name>${name}</name>`,
      `    <description>${description}</description>`,
      `    <location>${escape(location)}</location>`,
      ...(recommended
        ? ["    <note>This skill matches files in the current context. Consider loading it.</note>"]
        : []),
      "  </skill>",
    ].join("\n")
  }

  /** A character budget, not a tokenizer estimate. Never truncate a serialized entry. */
  export function page(input: Entry[], opts: Options) {
    const limit = opts.maxCharacters ?? MAX_CHARACTERS
    if (!Number.isInteger(limit) || limit < 512)
      throw new Error("Skill metadata budget must be at least 512 characters")
    const prefix = opts.verbose ? "<available_skills>" : "## Available Skills"
    const suffix = opts.verbose ? "</available_skills>" : ""
    let list = input
    let descriptionLimit = MAX_DESCRIPTION_CHARACTERS
    let all = input.map((entry) => render(entry, opts, descriptionLimit))
    if (!opts.paginate && all.join("\n").length + prefix.length + suffix.length + 282 > limit) {
      descriptionLimit = 160
      all = input.map((entry) => render(entry, opts, descriptionLimit))
    }
    if (
      !opts.paginate &&
      opts.recommended?.size &&
      all.join("\n").length + prefix.length + suffix.length + 282 > limit
    ) {
      list = input.toSorted((a, b) => Number(opts.recommended!.has(b.name)) - Number(opts.recommended!.has(a.name)))
    }
    const offset = opts.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid skill catalog offset")
    const entries: string[] = []
    const names: string[] = []
    let cursor = Math.min(offset, list.length)
    let oversized = 0
    // Reserve space for the omission notice and continuation instructions.
    const reserve = 280
    let used = prefix.length + suffix.length + 2
    while (cursor < list.length) {
      const entry = render(list[cursor], opts, descriptionLimit)
      if (entry.length + prefix.length + suffix.length + reserve + 3 > limit) {
        oversized++
        cursor++
        continue
      }
      if (used + entry.length + 1 + reserve > limit) break
      entries.push(entry)
      names.push(list[cursor].name)
      used += entry.length + 1
      cursor++
    }
    const omitted = list.length - Math.min(offset, list.length) - entries.length
    const nextOffset = opts.paginate && cursor < list.length ? cursor : undefined
    const notice = omitted
      ? `${omitted} skills omitted from this page${oversized ? ` (${oversized} oversized entries skipped)` : ""}. Use the skill tool with query to search metadata${nextOffset !== undefined ? `; continue this query with offset=${nextOffset}` : '; query="" lists eligible skills'}.`
      : ""
    const output = [prefix, ...entries, ...(suffix ? [suffix] : []), ...(notice ? [notice] : [])].join("\n")
    return { output, nextOffset, shown: entries.length, omitted, total: list.length, names }
  }

  export function search<T extends Entry>(list: T[], query: string): T[] {
    const needle = query.trim().toLowerCase()
    return list.filter((skill) => `${skill.name}\n${skill.description}`.toLowerCase().includes(needle))
  }
}
