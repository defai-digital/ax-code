import { MAX_LINE_LENGTH } from "../constants/tool"

/** Keep rendered and structured search lines aligned without splitting UTF-16 pairs. */
export function clampGrepLine(source: string): string {
  if (source.length <= MAX_LINE_LENGTH) return source
  let end = MAX_LINE_LENGTH
  const last = source.charCodeAt(end - 1)
  const next = source.charCodeAt(end)
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--
  return source.slice(0, end)
}
