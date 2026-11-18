import { ConfigPaths } from "./paths"
import { Info } from "./schema"
import { transactConfigFile, type ConfigFileEditOptions } from "./file-transaction"

/** Validate raw JSONC without evaluating environment or file references. */
export function parseConfig(text: string, filepath: string): Info {
  const data = ConfigPaths.parseJsoncOrThrow(text, filepath)
  const parsed = Info.safeParse(data)
  if (parsed.success) return parsed.data
  throw new ConfigPaths.InvalidError({ path: filepath, issues: parsed.error.issues })
}

export function editConfigFile(
  filepath: string,
  edit: (before: string | undefined) => string,
  options?: ConfigFileEditOptions,
): Promise<Info>
export function editConfigFile(
  filepath: string,
  edit: (before: string | undefined) => string | undefined,
  options?: ConfigFileEditOptions,
): Promise<Info | undefined>
/**
 * Serialize raw JSONC edits and validate before writing. Returning undefined
 * skips the write. Keep lifecycle work outside the synchronous editor;
 * callers refresh runtime state after this promise settles.
 */
export async function editConfigFile(
  filepath: string,
  edit: (before: string | undefined) => string | undefined,
  options: ConfigFileEditOptions = {},
): Promise<Info | undefined> {
  return transactConfigFile(
    filepath,
    (before) => {
      const updated = edit(before)
      if (updated === undefined) return
      return { text: updated, value: parseConfig(updated, filepath) }
    },
    options,
  )
}
