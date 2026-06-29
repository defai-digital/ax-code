import type { SnippetScope } from "@/stores/useSnippetsStore"

export type SaveSnippetResult =
  | { status: "name-required" }
  | { status: "content-required" }
  | { status: "saved" }
  | { status: "failed" }
  | { status: "unexpected-error"; error: unknown }

type CreateSnippet = (
  name: string,
  content: string,
  options?: { aliases?: string[]; description?: string; scope?: SnippetScope },
) => Promise<boolean>

type UpdateSnippet = (
  name: string,
  updates: { content?: string; aliases?: string[]; description?: string },
) => Promise<boolean>

export type SaveSnippetRequest = {
  isNew: boolean
  name: string | null | undefined
  content: string
  aliases: string
  description: string
  scope: SnippetScope
  createSnippet: CreateSnippet
  updateSnippet: UpdateSnippet
}

export const parseSnippetAliases = (aliases: string): string[] =>
  aliases
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean)

export const saveSnippet = async ({
  isNew,
  name,
  content,
  aliases,
  description,
  scope,
  createSnippet,
  updateSnippet,
}: SaveSnippetRequest): Promise<SaveSnippetResult> => {
  const snippetName = isNew ? name?.trim().replace(/\s+/g, "-") : name?.trim()
  if (!snippetName) {
    return { status: "name-required" }
  }

  if (!content.trim()) {
    return { status: "content-required" }
  }

  const parsedAliases = parseSnippetAliases(aliases)

  try {
    const success = isNew
      ? await createSnippet(snippetName, content, { aliases: parsedAliases, description, scope })
      : await updateSnippet(snippetName, { content, aliases: parsedAliases, description })
    return success ? { status: "saved" } : { status: "failed" }
  } catch (error) {
    return { status: "unexpected-error", error }
  }
}
