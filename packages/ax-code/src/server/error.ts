import { resolver } from "hono-openapi"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { NotFoundError } from "../storage/db"
import { Provider } from "../provider/provider"

export const AppErrorEnvelope = z
  .object({
    name: z.string(),
    message: z.string(),
    status: z.number().int().min(400).max(599),
    code: z.string().optional(),
    logRef: z.string().optional(),
    retryable: z.boolean().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({
    ref: "AppErrorEnvelope",
  })

export type AppErrorEnvelope = z.infer<typeof AppErrorEnvelope>

type NormalizedErrorInput = {
  error: unknown
  logRef?: string
}

function namedErrorData(error: NamedError): Record<string, unknown> {
  const data = error.toObject().data
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  return data as Record<string, unknown>
}

function resourceFromMessage(message: string) {
  if (/^Session not found\b/i.test(message)) return "session"
  if (/^Project not found\b/i.test(message)) return "project"
  if (/^MCP server not found\b/i.test(message)) return "mcpServer"
  if (/^Tool .* is unavailable\b/i.test(message)) return "tool"
  if (/^No LSP server available\b/i.test(message)) return "lsp"
  return undefined
}

function notFoundEnvelope(error: NamedError, logRef?: string): AppErrorEnvelope {
  const message = namedErrorData(error).message
  const text = typeof message === "string" ? message : error.message
  const resource = resourceFromMessage(text)
  const name =
    resource === "session"
      ? "SessionNotFoundError"
      : resource === "project"
        ? "ProjectNotFoundError"
        : resource === "mcpServer"
          ? "McpServerNotFoundError"
          : "NotFoundError"
  return {
    name,
    message: resource ? `${resource[0]!.toUpperCase()}${resource.slice(1)} not found` : "Resource not found",
    status: 404,
    logRef,
    details: resource ? { resource } : undefined,
  }
}

function httpExceptionEnvelope(error: HTTPException, logRef?: string): AppErrorEnvelope {
  const status = error.status as ContentfulStatusCode
  const name =
    status === 409
      ? "ServiceUnavailableError"
      : status === 404
        ? "NotFoundError"
        : status >= 400 && status < 500
          ? "InvalidRequestError"
          : "UnknownError"
  return {
    name,
    message: error.message || (status >= 500 ? "Internal server error" : "Invalid request"),
    status,
    logRef: status >= 500 ? logRef : undefined,
    retryable: status === 409 || status === 429 || status >= 500,
  }
}

function namedErrorEnvelope(error: NamedError, logRef?: string): AppErrorEnvelope {
  if (error instanceof NotFoundError) return notFoundEnvelope(error, logRef)
  if (error instanceof Provider.ModelNotFoundError) {
    return {
      name: "InvalidRequestError",
      message: "Provider model not found",
      status: 400,
      details: { resource: "providerModel" },
    }
  }
  if (error.name === "ProviderAuthValidationFailed") {
    return {
      name: "InvalidRequestError",
      message: "Provider authentication could not be validated",
      status: 400,
      details: { resource: "providerAuth" },
    }
  }
  if (error.name === "ProviderAuthOauthMissing") {
    return {
      name: "InvalidRequestError",
      message: "No pending authorization for this provider",
      status: 400,
      details: { resource: "providerAuth" },
    }
  }
  if (error.name === "ProviderAuthOauthCodeMissing") {
    return {
      name: "InvalidRequestError",
      message: "Authorization code is required",
      status: 400,
      details: { resource: "providerAuth" },
    }
  }
  if (error.name === "ProviderAuthOauthCallbackFailed") {
    return {
      name: "InvalidRequestError",
      message: "Provider authorization failed",
      status: 400,
      details: { resource: "providerAuth" },
    }
  }
  if (error.name === "ScheduledTaskInvalidSchedule") {
    const data = namedErrorData(error)
    const resource = typeof data.resource === "string" ? data.resource : undefined
    return {
      name: "InvalidRequestError",
      message: typeof data.message === "string" ? data.message : "Invalid schedule",
      status: 400,
      details: resource ? { resource } : undefined,
    }
  }
  if (error.name === "PtyInvalidCwd") {
    const data = namedErrorData(error)
    return {
      name: "InvalidRequestError",
      message: typeof data.message === "string" ? data.message : "Invalid PTY working directory",
      status: 400,
      details: { resource: "ptyCwd" },
    }
  }
  if (error.name === "FileAccessDenied") {
    const data = namedErrorData(error)
    return {
      name: "ForbiddenError",
      message: typeof data.message === "string" ? data.message : "Access denied",
      status: 403,
      details: { resource: "file" },
    }
  }
  if (error.name.startsWith("Worktree")) {
    return {
      name: "InvalidRequestError",
      message: "Worktree request is invalid",
      status: 400,
      details: { resource: "worktree" },
    }
  }
  // NamedError.Unknown stores the real message in data.message, while Error.message
  // is the class name ("UnknownError"). Surface client-caused command failures as 400
  // so Desktop does not remap them to a generic "Unknown command" from a 500.
  if (error.name === "UnknownError") {
    const data = namedErrorData(error)
    const message = typeof data.message === "string" ? data.message : ""
    if (/^Command not found:/i.test(message) || /requires an argument\./i.test(message)) {
      return {
        name: "InvalidRequestError",
        message,
        status: 400,
        details: { resource: "command" },
        retryable: false,
      }
    }
  }
  return {
    name: "UnknownError",
    message: "Internal server error",
    status: 500,
    logRef,
    retryable: false,
  }
}

function plainErrorEnvelope(error: Error, logRef?: string): AppErrorEnvelope {
  if (error.constructor.name === "BusyError" && /^Session .* is busy$/.test(error.message)) {
    return {
      name: "SessionBusyError",
      message: "Session is busy",
      status: 409,
      details: { resource: "session" },
      retryable: true,
    }
  }
  if (/^Tool .* is unavailable\b/i.test(error.message)) {
    return {
      name: "ToolUnavailableError",
      message: "Tool is unavailable",
      status: 409,
      details: { resource: "tool" },
      retryable: false,
    }
  }
  if (/^No LSP server available\b/i.test(error.message)) {
    return {
      name: "LspUnavailableError",
      message: "No LSP server available",
      status: 409,
      details: { resource: "lsp" },
      retryable: false,
    }
  }
  if (/^MCP server not found\b/i.test(error.message)) {
    return {
      name: "McpServerNotFoundError",
      message: "McpServer not found",
      status: 404,
      details: { resource: "mcpServer" },
    }
  }
  if (/^Access denied:/i.test(error.message)) {
    return {
      name: "ForbiddenError",
      message: error.message,
      status: 403,
      details: { resource: "file" },
    }
  }
  return {
    name: "UnknownError",
    message: "Internal server error",
    status: 500,
    logRef,
    retryable: false,
  }
}

export function appErrorEnvelope(input: NormalizedErrorInput): AppErrorEnvelope {
  const { error, logRef } = input
  if (error instanceof HTTPException) return httpExceptionEnvelope(error, logRef)
  if (error instanceof NamedError) return namedErrorEnvelope(error, logRef)
  if (error instanceof Error) return plainErrorEnvelope(error, logRef)
  return {
    name: "UnknownError",
    message: "Internal server error",
    status: 500,
    logRef,
    retryable: false,
  }
}

export function appErrorResponse(c: Context, envelope: AppErrorEnvelope): Response {
  return c.json(envelope, { status: envelope.status as ContentfulStatusCode })
}

export function invalidRequest(
  c: Context,
  input: { message?: string; details?: Record<string, unknown> } = {},
): Response {
  return appErrorResponse(c, {
    name: "InvalidRequestError",
    message: input.message ?? "Invalid request",
    status: 400,
    details: input.details,
  })
}

export function notFound(c: Context, input: { name?: string; message?: string; resource?: string } = {}): Response {
  return appErrorResponse(c, {
    name: input.name ?? "NotFoundError",
    message: input.message ?? "Resource not found",
    status: 404,
    details: input.resource ? { resource: input.resource } : undefined,
  })
}

export function forbidden(c: Context, input: { message?: string; details?: Record<string, unknown> } = {}): Response {
  return appErrorResponse(c, {
    name: "InvalidRequestError",
    message: input.message ?? "Forbidden",
    status: 403,
    details: input.details,
  })
}

export function serviceUnavailable(
  c: Context,
  input: { message?: string; details?: Record<string, unknown>; retryable?: boolean } = {},
): Response {
  return appErrorResponse(c, {
    name: "ServiceUnavailableError",
    message: input.message ?? "Service unavailable",
    status: 409,
    retryable: input.retryable ?? true,
    details: input.details,
  })
}

export function rateLimited(c: Context): Response {
  return appErrorResponse(c, {
    name: "ServiceUnavailableError",
    message: "Too many requests",
    status: 429,
    retryable: true,
  })
}

export const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(AppErrorEnvelope),
      },
    },
  },
  403: {
    description: "Forbidden",
    content: {
      "application/json": {
        schema: resolver(AppErrorEnvelope),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(AppErrorEnvelope),
      },
    },
  },
  409: {
    description: "Conflict",
    content: {
      "application/json": {
        schema: resolver(AppErrorEnvelope),
      },
    },
  },
  429: {
    description: "Too many requests",
    content: {
      "application/json": {
        schema: resolver(AppErrorEnvelope),
      },
    },
  },
  500: {
    description: "Internal server error",
    content: {
      "application/json": {
        schema: resolver(AppErrorEnvelope),
      },
    },
  },
} as const

export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}
