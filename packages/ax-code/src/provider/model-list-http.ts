import { BodyTooLargeError, readBoundedBody } from "@/util/http-body"
import { parseJsonStrict } from "@/util/json-value"
import { isLocalHostname } from "@/util/local-host"
import { Ssrf } from "@/util/ssrf"
import { toErrorMessage } from "@/util/error-message"

// Accommodates thousands of model cards while bounding the buffered JSON.
const MODEL_LIST_MAX_BYTES = 8 * 1024 * 1024

export type ModelListFetcher = (url: string, init: RequestInit) => Promise<Response>

export function modelListBearerHeaders(token: string): Record<string, string> {
  return { Authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}` }
}

/** Fetch a model list with the provider's transport and retain its error context. */
export async function requestModelList(input: {
  url: string
  label: string
  headers?: Record<string, string>
  redirect?: "error" | "follow"
  timeoutMs: number
  signal?: AbortSignal
  fetcher?: ModelListFetcher
}): Promise<unknown> {
  const fetcher = input.fetcher ?? (isLocalHostname(new URL(input.url).hostname) ? fetch : Ssrf.pinnedFetch)
  const timeout = AbortSignal.timeout(input.timeoutMs)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  let response: Response
  try {
    signal.throwIfAborted()
    response = await fetcher(input.url, {
      method: "GET",
      headers: input.headers,
      redirect: input.redirect ?? "error",
      signal,
    })
  } catch (cause) {
    if (signal.aborted) throw cause
    throw new Error(`${input.label} failed: ${toErrorMessage(cause)}`, { cause })
  }

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error(`${input.label} returned HTTP ${response.status}`)
  }

  let body: Uint8Array
  try {
    body = await readBoundedBody(response, MODEL_LIST_MAX_BYTES)
  } catch (cause) {
    if (signal.aborted) throw cause
    if (cause instanceof BodyTooLargeError) {
      throw new Error(`${input.label} exceeded the model list size limit`, { cause })
    }
    if (!response.body) throw new Error(`${input.label} returned invalid JSON`, { cause })
    throw new Error(`${input.label} failed while reading the response: ${toErrorMessage(cause)}`, { cause })
  }

  try {
    return parseJsonStrict(new TextDecoder().decode(body))
  } catch (cause) {
    throw new Error(`${input.label} returned invalid JSON`, { cause })
  }
}
