/**
 * True when a plugin or provider specifier is a `file:` URL rather than a
 * package name or a filesystem path. The plugin loader, the config loader and
 * the provider loader each carried a private copy of this check.
 */
export function isFileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "file:"
  } catch {
    return false
  }
}
