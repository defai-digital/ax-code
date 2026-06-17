import { abortAfterAny } from "../util/abort"
import { EXA_BASE_URL, EXA_ENDPOINT } from "@/constants/network"
import { Ssrf } from "@/util/ssrf"
import { parseJsonPayload } from "@/util/json-value"
import z from "zod"

const MAX_RESPONSE_BYTES = 1024 * 1024

const McpResponse = z
  .object({
    result: z
      .object({
        content: z.array(
          z
            .object({
              text: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough()

export function decodeExaMcpContentText(value: unknown): string | undefined {
  const decoded = McpResponse.safeParse(value)
  return decoded.success ? decoded.data.result.content[0]?.text : undefined
}

export function parseExaSseContentText(line: string): string | undefined {
  if (!line.startsWith("data: ")) return undefined
  const parsed = parseJsonPayload(line.substring(6))
  if (parsed === undefined) return undefined
  return decodeExaMcpContentText(parsed)
}

/**
 * Shared fetch logic for Exa MCP tools (websearch and codesearch).
 */
export async function fetchExaTool(config: {
  request: object
  timeout: number
  errorPrefix: string
  noResultsMessage: string
  title: string
  abort?: AbortSignal
}): Promise<{ output: string; title: string; metadata: Record<string, never> }> {
  const { signal, clearTimeout } = abortAfterAny(config.timeout, ...(config.abort ? [config.abort] : []))

  try {
    const response = await Ssrf.pinnedFetch(`${EXA_BASE_URL}${EXA_ENDPOINT}`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(config.request),
      signal,
      redirect: "manual",
      label: "exa-fetch",
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      // Cancel the response body to release the underlying socket.
      // Without this, the unconsumed body leaks a TCP connection.
      await response.body?.cancel().catch(() => {})
      if (!location) throw new Error(`${config.errorPrefix}: redirect with no location`)
      await Ssrf.assertPublicUrl(new URL(location, `${EXA_BASE_URL}${EXA_ENDPOINT}`).toString(), "exa-fetch")
      throw new Error(`${config.errorPrefix}: redirect refused`)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`${config.errorPrefix} (${response.status}): ${errorText}`)
    }

    const body = await response.bytes()
    if (body.length > MAX_RESPONSE_BYTES) {
      throw new Error(`${config.errorPrefix}: response too large`)
    }
    const responseText = new TextDecoder().decode(body)

    // Parse SSE response. Collect every content-bearing event and
    // return the LAST one. Previously this returned on the first
    // event with content, which would cut off the final result if the
    // API emitted any preliminary events (partial content, status
    // updates, etc.) before the complete answer.
    const lines = responseText.split("\n")
    let lastResult: { output: string; title: string; metadata: Record<string, never> } | undefined
    for (const line of lines) {
      const text = parseExaSseContentText(line)
      if (text) {
        lastResult = {
          output: text,
          title: config.title,
          metadata: {},
        }
      }
    }
    if (lastResult) return lastResult

    return {
      output: config.noResultsMessage,
      title: config.title,
      metadata: {},
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${config.errorPrefix} timed out`, { cause: error })
    }

    throw error
  } finally {
    clearTimeout()
  }
}
