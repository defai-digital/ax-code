import { APICallError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import { isRecord } from "@/util/record"
import { parseJsonRecord as parseJsonRecordUtil } from "@/util/json-record"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import type { ProviderID } from "./schema"

export namespace ProviderError {
  // Adapted from overflow detection patterns in:
  // https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/overflow.ts
  const OVERFLOW_PATTERNS = [
    /prompt is too long/i, // Anthropic
    /input is too long for requested model/i, // Amazon Bedrock
    /exceeds the context window/i, // OpenAI (Completions + Responses API message text)
    /input token count.*exceeds the maximum/i, // Google (Gemini)
    /maximum prompt length is \d+/i, // xAI (Grok)
    /reduce the length of the messages/i, // Groq
    /maximum context length is \d+ tokens/i, // DeepSeek, vLLM
    /exceeds the limit of \d+/i, // GitHub Copilot
    /exceeds the available context size/i, // llama.cpp server
    /greater than the context length/i, // LM Studio
    /context window exceeds limit/i, // MiniMax
    /exceeded model token limit/i, // OpenAI-compatible generic
    /context[_ ]length[_ ]exceeded/i, // Generic fallback
    /context length is only \d+ tokens/i, // vLLM
    /input length.*exceeds.*context length/i, // vLLM
  ]

  const REQUEST_TOO_LARGE_PATTERNS = [
    /request entity too large/i,
    /request body.*too large/i,
    /payload too large/i,
    /^413\s*(status code)?\s*\(no body\)/i,
  ]

  // Providers not reliably handled in this function:
  // - z.ai: can accept overflow silently (needs token-count/context-window checks)
  function isOverflow(message: string, providerID?: ProviderID) {
    if (OVERFLOW_PATTERNS.some((p) => p.test(message))) return true

    // Mistral can report a context overflow as a bare 400. A bare 413 is
    // classified separately as request-body overflow below. Keep the bare-400
    // fallback Mistral-specific: an empty-body 400 from any other provider is
    // usually a gateway or parameter rejection, and classifying it as context
    // overflow would disable retries and trigger unwarranted compaction.
    if (providerID !== undefined && providerID !== "mistral") return false
    return /^400\s*(status code)?\s*\(no body\)/i.test(message)
  }

  function isRequestTooLargeMessage(message: string) {
    return REQUEST_TOO_LARGE_PATTERNS.some((pattern) => pattern.test(message))
  }

  function isHttp413(value: unknown) {
    return value === 413 || value === "413"
  }

  /** Classifies context overflow shapes outside the standard APICallError. */
  export function isContextOverflow(input: unknown, providerID?: ProviderID) {
    if (typeof input === "string") return isOverflow(input, providerID)
    if (!isRecord(input)) return false
    const nested = isRecord(input.error) ? input.error : undefined
    if (input.code === "context_length_exceeded" || nested?.code === "context_length_exceeded") return true
    const message =
      typeof nested?.message === "string" ? nested.message : typeof input.message === "string" ? input.message : ""
    return isOverflow(message, providerID)
  }

  /** Classifies non-standard SDK errors that did not arrive as APICallError. */
  export function isRequestTooLarge(input: unknown) {
    if (typeof input === "string") return isRequestTooLargeMessage(input)
    if (!isRecord(input)) return false
    const nested = isRecord(input.error) ? input.error : undefined
    const message =
      typeof nested?.message === "string" ? nested.message : typeof input.message === "string" ? input.message : ""
    if (input.code === "context_length_exceeded" || nested?.code === "context_length_exceeded" || isOverflow(message)) {
      return false
    }
    return (
      isHttp413(input.statusCode) ||
      isHttp413(input.status) ||
      isHttp413(nested?.statusCode) ||
      isHttp413(nested?.status) ||
      input.code === "request_too_large" ||
      nested?.code === "request_too_large" ||
      isRequestTooLargeMessage(message)
    )
  }

  function message(e: APICallError) {
    return iife(() => {
      const msg = e.message
      if (msg === "") {
        if (e.responseBody) return e.responseBody
        if (e.statusCode) {
          const err = STATUS_CODES[e.statusCode]
          if (err) return err
        }
        return "Unknown error"
      }

      if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) {
        return msg
      }

      const responseMessage = responseBodyErrorMessage(e.responseBody)
      if (responseMessage) return `${msg}: ${responseMessage}`

      // If responseBody is HTML (e.g. from a gateway or proxy error page),
      // provide a human-readable message instead of dumping raw markup
      if (/^\s*<!doctype|^\s*<html/i.test(e.responseBody)) {
        if (e.statusCode === 401) {
          return "Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired — try running `ax-code auth login <your provider URL>` to re-authenticate."
        }
        if (e.statusCode === 403) {
          return "Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource — check your account and provider settings."
        }
        return msg
      }

      return `${msg}: ${e.responseBody}`
    }).trim()
  }

  export function parseJsonRecord(input: unknown): Record<string, unknown> | undefined {
    return parseJsonRecordUtil(input)
  }

  export function responseBodyErrorMessage(responseBody: string): string | undefined {
    const body = parseJsonRecord(responseBody)
    if (!body) return undefined

    if (typeof body.message === "string" && body.message) return body.message
    if (isRecord(body.error)) {
      const nestedMessage = body.error.message
      if (typeof nestedMessage === "string" && nestedMessage) return nestedMessage
    }
    if (typeof body.error === "string" && body.error) return body.error
    return undefined
  }

  function stringifyResponseBody(body: Record<string, unknown>): string {
    const seen = new WeakSet<object>()
    try {
      return (
        JSON.stringify(body, (_key, value) => {
          if (typeof value === "bigint") return value.toString()
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return "[Circular]"
            seen.add(value)
          }
          return value
        }) ?? "{}"
      )
    } catch (error) {
      return JSON.stringify({
        type: "error",
        error: {
          message: toErrorMessage(error, "Unknown serialization error"),
        },
      })
    }
  }

  // DashScope (Coding Plan) and Token Plan both throttle on a sliding
  // short-window allocatable-token reservation. Same error class, same
  // mitigation — recognize either backend so retry/backoff applies uniformly.
  function isAlibabaShortWindowQuota(providerID: ProviderID, message: string, responseBody?: string, url?: string) {
    const hostname = parseHostname(url)
    const urlIsAlibaba =
      isAlibabaCloudHost(hostname) && (hostname.startsWith("token-plan.") || hostname.startsWith("dashscope."))
    const isAlibaba = providerID.startsWith("alibaba-") || urlIsAlibaba
    if (!isAlibaba) return false
    const text = `${message}\n${responseBody ?? ""}`.toLowerCase()
    return (
      text.includes("allocated quota exceeded") ||
      text.includes("increase your quota limit") ||
      text.includes("model-studio/error-code#token-limit")
    )
  }

  const log = Log.create({ service: "provider.error" })

  function parseHostname(url: string | undefined): string {
    if (!url) return ""
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      log.warn("failed to parse URL for hostname extraction", { url })
      return ""
    }
  }

  function isAlibabaCloudHost(hostname: string): boolean {
    return hostname === "aliyuncs.com" || hostname.endsWith(".aliyuncs.com")
  }

  function alibabaShortWindowQuotaMessage() {
    return "Alibaba rejected the request as exceeding short-window allocatable token quota. This is a per-request or TPS/TPM reservation limit, not total plan usage. ax-code treats this as retryable short-window throttling; if it persists, wait briefly or lower the per-request output cap via AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX (e.g. 2048 or 1024). Details: https://www.alibabacloud.com/help/en/model-studio/error-code#token-limit"
  }

  export type ParsedStreamError =
    | {
        type: "context_overflow"
        message: string
        responseBody: string
      }
    | {
        type: "request_too_large"
        message: string
        responseBody: string
      }
    | {
        type: "api_error"
        message: string
        isRetryable: false
        responseBody: string
      }

  export function parseStreamError(input: unknown): ParsedStreamError | undefined {
    const body = parseJsonRecord(input)
    if (!body) return
    const bodyError = isRecord(body.error) ? body.error : undefined

    const responseBody = stringifyResponseBody(body)
    if (body.type !== "error") return

    switch (bodyError?.code) {
      case "context_length_exceeded":
        return {
          type: "context_overflow",
          message: "Input exceeds context window of this model",
          responseBody,
        }
      case "insufficient_quota":
        return {
          type: "api_error",
          message: "Quota exceeded. Check your plan and billing details.",
          isRetryable: false,
          responseBody,
        }
      case "usage_not_included":
        return {
          type: "api_error",
          message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
          isRetryable: false,
          responseBody,
        }
      case "invalid_prompt":
        return {
          type: "api_error",
          message: typeof bodyError?.message === "string" ? bodyError.message : "Invalid prompt.",
          isRetryable: false,
          responseBody,
        }
    }

    const bodyMessage = typeof bodyError?.message === "string" ? bodyError.message : ""
    if (isContextOverflow(body)) {
      return {
        type: "context_overflow",
        message: bodyMessage || "Input exceeds context window of this model",
        responseBody,
      }
    }
    if (isRequestTooLarge(body)) {
      return {
        type: "request_too_large",
        message: bodyMessage || "Provider rejected the request body as too large",
        responseBody,
      }
    }
  }

  export type ParsedAPICallError =
    | {
        type: "context_overflow"
        message: string
        responseBody?: string
      }
    | {
        type: "request_too_large"
        message: string
        statusCode?: number
        responseBody?: string
      }
    | {
        type: "api_error"
        message: string
        statusCode?: number
        isRetryable: boolean
        responseHeaders?: Record<string, string>
        responseBody?: string
        metadata?: Record<string, string>
      }

  export function parseAPICallError(input: { providerID: ProviderID; error: APICallError }): ParsedAPICallError {
    const m = message(input.error)
    const body = parseJsonRecord(input.error.responseBody)
    const bodyError = isRecord(body?.error) ? body.error : undefined
    // Prefer explicit token/context evidence even when a gateway happens to
    // use HTTP 413. Generic 413/request-entity errors are request-body limits
    // (commonly accumulated base64 media) and need a media projection before
    // token-driven compaction.
    if (isOverflow(m, input.providerID) || bodyError?.code === "context_length_exceeded") {
      return {
        type: "context_overflow",
        message: m,
        responseBody: input.error.responseBody,
      }
    }
    if (input.error.statusCode === 413 || isRequestTooLargeMessage(m)) {
      return {
        type: "request_too_large",
        message: m,
        statusCode: input.error.statusCode,
        responseBody: input.error.responseBody,
      }
    }

    const metadata = input.error.url ? { url: input.error.url } : undefined

    if (isAlibabaShortWindowQuota(input.providerID, m, input.error.responseBody, input.error.url)) {
      return {
        type: "api_error",
        message: alibabaShortWindowQuotaMessage(),
        statusCode: input.error.statusCode,
        isRetryable: true,
        responseHeaders: input.error.responseHeaders,
        responseBody: input.error.responseBody,
        metadata: {
          ...(metadata ?? {}),
          // Keep historical error-code value so any downstream telemetry that
          // already pivots on it (dashboards, session retry) keeps matching.
          errorCode: "alibaba_token_plan_short_window_quota",
        },
      }
    }

    // OpenAI uses 404 for some temporary errors (model not found due to capacity/routing)
    const isRetryable = input.error.isRetryable || (input.providerID === "openai" && input.error.statusCode === 404)

    return {
      type: "api_error",
      message: m,
      statusCode: input.error.statusCode,
      isRetryable,
      responseHeaders: input.error.responseHeaders,
      responseBody: input.error.responseBody,
      metadata,
    }
  }
}
