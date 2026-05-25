import { describe, expect, test } from "bun:test"
import { decodeTranslationsValue, parseTranslationsText, t } from "../src/i18n/loader"

const validTranslations = {
  session: {
    welcome: "Welcome",
    thinking: "Thinking",
    generating: "Generating",
    goodbye: "Goodbye",
    sessionEnded: "Session ended",
  },
  tools: {
    executing: "Executing",
    completed: "Completed",
    failed: "Failed",
    readingFile: "Reading file",
    writingFile: "Writing file",
    searchingFiles: "Searching files",
    commandRunning: "Running command",
    commandCompleted: "Command completed",
  },
  errors: {
    connectionFailed: "Connection failed",
    apiError: "API error",
    rateLimited: "Rate limited",
    timeout: "Timed out",
    permissionDenied: "Permission denied",
    fileNotFound: "File not found",
    invalidInput: "Invalid input",
    unknown: "Unknown error",
  },
  toast: {
    copiedToClipboard: "Copied",
    changesSaved: "Saved",
    operationCancelled: "Cancelled",
    agentSwitched: "Agent switched",
  },
  usage: {
    tokens: "tokens",
    tokensIn: "Input tokens",
    tokensOut: "Output tokens",
  },
  status: {
    thinking: "Thinking",
    context: "Context",
    contextWarning: "Context warning",
  },
}

describe("i18n loader decoding", () => {
  test("parses valid translation JSON", () => {
    expect(parseTranslationsText(JSON.stringify(validTranslations)).errors.apiError).toBe("API error")
  })

  test("decodes valid translation objects", () => {
    expect(decodeTranslationsValue(validTranslations).session.welcome).toBe("Welcome")
  })

  test("looks up known translation paths", () => {
    expect(t("errors.apiError")).toBe("API error")
  })

  test("rejects malformed or incomplete translation JSON", () => {
    expect(() => parseTranslationsText("{not json")).toThrow(/invalid JSON/)
    expect(() =>
      decodeTranslationsValue({
        ...validTranslations,
        errors: {
          ...validTranslations.errors,
          apiError: 500,
        },
      }),
    ).toThrow(/errors\.apiError/)
    expect(() =>
      parseTranslationsText(
        JSON.stringify({
          ...validTranslations,
          errors: {
            ...validTranslations.errors,
            apiError: 500,
          },
        }),
      ),
    ).toThrow(/errors\.apiError/)
  })

  test("returns key when a translation path is unknown", () => {
    expect(t("missing.path")).toBe("missing.path")
  })
})
