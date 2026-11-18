import { ConfigPaths } from "./paths"
import { Info } from "./schema"
import {
  transactConfigFile,
  transactConfigFileWithRollback,
  type ConfigFileEdit,
  type ConfigFileEditOptions,
  type ConfigFileRollback,
} from "./file-transaction"

/** Validate raw JSONC without evaluating environment or file references. */
export function parseConfig(text: string, filepath: string): Info {
  const data = ConfigPaths.parseJsoncOrThrow(text, filepath)
  const parsed = Info.safeParse(data)
  if (parsed.success) return parsed.data
  throw new ConfigPaths.InvalidError({ path: filepath, issues: parsed.error.issues })
}

function validatedEdit(
  filepath: string,
  edit: (before: string | undefined) => string | undefined,
): (before: string | undefined) => ConfigFileEdit<Info> | undefined {
  return (before) => {
    const updated = edit(before)
    if (updated === undefined) return
    return { text: updated, value: parseConfig(updated, filepath) }
  }
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
  return transactConfigFile(filepath, validatedEdit(filepath, edit), options)
}

/** Keep raw JSONC restoration and its ownership check inside the file transaction. */
export async function editConfigFileWithRollback(
  filepath: string,
  edit: (before: string | undefined) => string | undefined,
  options: ConfigFileEditOptions = {},
): Promise<ConfigFileRollback<Info> | undefined> {
  return transactConfigFileWithRollback(filepath, validatedEdit(filepath, edit), options)
}
