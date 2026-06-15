import path from "path"
import z from "zod"

export const NULL_BYTE_PATH_ERROR = "File path contains null byte"

/**
 * Parameter-key synonyms that models emit instead of the canonical `filePath`.
 * Some providers (notably ax-engine/qwen3-coder) call `write`/`edit`/`read`
 * with `{ file, content }`; the resulting schema-validation error is returned
 * to the model, which can then degenerate into truncated garbage output
 * instead of retrying. Normalizing the alias to `filePath` before validation
 * keeps these calls working without advertising the alias in the tool schema.
 */
export const FILE_PATH_ALIAS_KEYS = ["file", "path", "file_path", "filepath", "filename", "fileName", "file_name"]

/**
 * Wrap a tool's parameter object so a `filePath` alias (see
 * {@link FILE_PATH_ALIAS_KEYS}) is rewritten to `filePath` before validation.
 * Only applied when `filePath` is absent, so a correct call is never altered.
 * The generated JSON schema is unchanged — `z.toJSONSchema` reflects the inner
 * object, so the model still only sees `filePath`.
 */
export function withFilePathAliases<T extends z.ZodType>(schema: T): z.ZodType<z.infer<T>, z.input<T>> {
  return z.preprocess((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
    const record = raw as Record<string, unknown>
    if (typeof record["filePath"] === "string") return raw
    for (const key of FILE_PATH_ALIAS_KEYS) {
      const value = record[key]
      if (typeof value === "string" && value.length > 0) {
        return { ...record, filePath: value }
      }
    }
    return raw
  }, schema) as unknown as z.ZodType<z.infer<T>, z.input<T>>
}

export function resolveToolFilePath(filePath: string, baseDirectory: string) {
  if (filePath.includes("\x00")) {
    throw new Error(NULL_BYTE_PATH_ERROR)
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDirectory, filePath)
}

export function normalizeToWorkspacePath(filePath: string, worktree: string) {
  if (path.isAbsolute(filePath)) {
    return path.relative(worktree, filePath).replaceAll("\\", "/")
  }
  return filePath.replaceAll("\\", "/")
}
