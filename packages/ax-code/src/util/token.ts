export namespace Token {
  const CHARS_PER_TOKEN = 4

  // CJK ideographs, kana, Hangul, CJK punctuation and fullwidth forms tokenize
  // at roughly one token per character, far denser than the four-characters-
  // per-token rule that holds for Latin text. Counting them at the Latin rate
  // under-counted CJK-heavy sessions by ~4x across every estimator consumer
  // (preflight admission, the token ledger, context_status), which silently
  // delayed auto-compaction for Chinese/Japanese/Korean sessions.
  const CJK_CHARS_PER_TOKEN = 1

  // Any non-ASCII byte means the string may contain CJK; the fast path below
  // returns the plain chars/4 estimate when it does not, so pure-ASCII text
  // (code, English) never pays for the per-character scan.
  const NON_ASCII = /[^\x00-\x7f]/

  function isCjkCodeUnit(code: number) {
    return (
      (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x303f) || // CJK radicals, Kangxi, CJK symbols/punctuation
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0x3130 && code <= 0x318f) || // Hangul compatibility Jamo
      (code >= 0x3400 && code <= 0x4dbf) || // CJK unified ideographs extension A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
      (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo extended-A
      (code >= 0xac00 && code <= 0xd7af) || // Hangul syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
      (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
      (code >= 0xff00 && code <= 0xffef) // Halfwidth/Fullwidth forms
    )
  }

  export function estimate(input: string) {
    const text = input || ""
    if (text.length === 0) return 0
    if (!NON_ASCII.test(text)) return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))

    let cjk = 0
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        i++ // skip the low surrogate of an astral pair
        continue
      }
      if (isCjkCodeUnit(code)) cjk++
    }
    const rest = text.length - cjk
    return Math.max(0, Math.round(cjk / CJK_CHARS_PER_TOKEN + rest / CHARS_PER_TOKEN))
  }
}
