export namespace QualityStorageKey {
  export function encode(input: string) {
    return encodeURIComponent(input)
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
