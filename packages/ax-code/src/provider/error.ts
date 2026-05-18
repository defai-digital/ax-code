import { APICallError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import { isRecord } from "@/util/record"
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
    /maximum context length is \d+ tokens/i, // OpenRouter, DeepSeek, vLLM
    /exceeds the limit of \d+/i, // GitHub Copilot
    /exceeds the available context size/i, // llama.cpp server
    /greater than the context length/i, // LM Studio
    /context window exceeds limit/i, // MiniMax
    /exceeded model token limit/i, // OpenAI-compatible generic
    /context[_ ]length[_ ]exceeded/i, // Generic fallback
    /request entity too large/i, // HTTP 413
    /context length is only \d+ tokens/i, // vLLM
    /input length.*exceeds.*context length/i, // vLLM
  ]

  // Providers not reliably handled in this function:
  // - z.ai: can accept overflow silently (needs token-count/context-window checks)
  function isOverflow(message: string) {
    if (OVERFLOW_PATTERNS.some((p) => p.test(message))) return true

    // Providers/status patterns handled outside of regex list:
    // - Mistral: often returns "400 (no body)" / "413 (no body)"
    return /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message)
  }

  function message(providerID: ProviderID, e: APICallError) {
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

      try {
        const body = JSON.parse(e.responseBody)
        // try to extract common error message fields
        const errMsg = body.message || body.error?.message || body.error
        if (errMsg && typeof errMsg === "string") {
          return `${msg}: ${errMsg}`
        }
      } catch {}

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

  function json(input: unknown) {
    if (typeof input === "string") {
      try {
        const result = JSON.parse(input)
        if (isRecord(result)) return result
        return undefined
      } catch {
        return undefined
      }
    }
    if (isRecord(input)) {
      return input
    }
    return undefined
  }

  // DashScope (Coding Plan) and Token Plan both throttle on a sliding
  // short-window allocatable-token reservation. Same error class, same
  // mitigation — recognize either backend so retry/backoff applies uniformly.
  function isAlibabaShortWindowQuota(providerID: ProviderID, message: string, responseBody?: string, url?: string) {
    const lowerUrl = url?.toLowerCase() ?? ""
    const urlIsAlibaba =
      lowerUrl.includes("aliyuncs.com") && (lowerUrl.includes("token-plan.") || lowerUrl.includes("dashscope."))
    const isAlibaba = providerID.startsWith("alibaba-") || urlIsAlibaba
    if (!isAlibaba) return false
    const text = `${message}\n${responseBody ?? ""}`.toLowerCase()
    return (
      text.includes("allocated quota exceeded") ||
      text.includes("increase your quota limit") ||
      text.includes("model-studio/error-code#token-limit")
    )
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
        type: "api_error"
        message: string
        isRetryable: false
        responseBody: string
      }

  export function parseStreamError(input: unknown): ParsedStreamError | undefined {
    const body = json(input)
    if (!body) return
    const bodyError = isRecord(body.error) ? body.error : undefined

    const responseBody = JSON.stringify(body)
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
  }

  export type ParsedAPICallError =
    | {
        type: "context_overflow"
        message: string
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
    const m = message(input.providerID, input.error)
    const body = json(input.error.responseBody)
    const bodyError = isRecord(body?.error) ? body.error : undefined
    if (isOverflow(m) || input.error.statusCode === 413 || bodyError?.code === "context_length_exceeded") {
      return {
        type: "context_overflow",
        message: m,
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
