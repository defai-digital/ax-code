import { describe, expect, test } from "bun:test"
import { parseDesktopDiagnosticExport, redactDiagnosticValue } from "../src/headless.js"

describe("headless diagnostics contract", () => {
  test("parses typed desktop diagnostic exports", () => {
    expect(
      parseDesktopDiagnosticExport({
        appVersion: "5.9.3",
        platform: "darwin-arm64",
        backendMode: "sidecar",
        backendHealth: "healthy",
        streamHealth: "connected",
        logRefs: ["err_123"],
        recentErrors: [
          {
            name: "UnknownError",
            message: "Internal server error",
            status: 500,
            logRef: "err_123",
          },
        ],
      }),
    ).toMatchObject({
      backendMode: "sidecar",
      backendHealth: "healthy",
      streamHealth: "connected",
      logRefs: ["err_123"],
    })
  })

  test("redacts sensitive diagnostic fields recursively before validation", () => {
    const parsed = parseDesktopDiagnosticExport({
      appVersion: "5.9.3",
      platform: "linux-x64",
      backendMode: "attached",
      backendHealth: "unavailable",
      streamHealth: "error",
      logRefs: ["err_456"],
      recentErrors: [
        {
          name: "InvalidRequestError",
          message: "Invalid request",
          status: 400,
          details: {
            token: "sk-test-token",
            nested: {
              authorization: "Bearer secret",
              safe: "kept",
            },
          },
        },
      ],
    })

    expect(parsed.recentErrors[0].details).toEqual({
      token: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        safe: "kept",
      },
    })
  })

  test("redaction utility never exposes known secret-like keys", () => {
    expect(
      redactDiagnosticValue({
        providerKey: "provider-secret",
        backendPassword: "generated-password",
        ok: [{ api_key: "api-secret", value: "safe" }],
      }),
    ).toEqual({
      providerKey: "[REDACTED]",
      backendPassword: "[REDACTED]",
      ok: [{ api_key: "[REDACTED]", value: "safe" }],
    })
  })
})
