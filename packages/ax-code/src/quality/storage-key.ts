export namespace QualityStorageKey {
  /**
   * Path-safe encoding for storage key segments. `encodeURIComponent` alone
   * leaves "." and ".." untouched, and Storage joins key segments with
   * path.join — a dot segment escapes the namespace directory entirely.
   * Percent-encoding the dots of those two exact segments keeps every other
   * key byte-identical (existing records stay readable) while making the
   * pathological segments inert path components.
   */
  export function encode(input: string) {
    if (input === "") throw new Error("Quality storage key segments must not be empty")
    const encoded = encodeURIComponent(input)
    if (encoded === ".") return "%2E"
    if (encoded === "..") return "%2E%2E"
    return encoded
  }

  export function decode(input: string) {
    try {
      return decodeURIComponent(input)
    } catch (err) {
      if (err instanceof URIError) return
      throw err
    }
  }
}
