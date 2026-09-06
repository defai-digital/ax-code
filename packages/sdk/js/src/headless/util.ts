export { errorMessage } from "../internal/error.js"

/** Parse a headless HTTP response body; empty bodies become `true`. */
export function parseHeadlessRuntimeResponseBody(text: string): unknown {
  if (!text) return true
  return parseHeadlessRuntimeJsonBody(text)
}

/** Parse a headless JSON body, throwing a readable error on invalid JSON. */
export function parseHeadlessRuntimeJsonBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new Error(`Headless runtime returned invalid JSON: ${text.slice(0, 200)}`, { cause })
  }
}
