export { errorMessage } from "../internal/error.js"

export function parseHeadlessRuntimeResponseBody(text: string): unknown {
  if (!text) return true
  return parseHeadlessRuntimeJsonBody(text)
}

export function parseHeadlessRuntimeJsonBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new Error(`Headless runtime returned invalid JSON: ${text.slice(0, 200)}`, { cause })
  }
}
