import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { REQUIRED_OPENAPI_PATHS, parseOpenApiSnapshot, validateOpenApiSnapshot } from "../src/openapi/contract"

const openApiSnapshotPath = fileURLToPath(new URL("../../openapi.json", import.meta.url))
const generatedSdkPath = fileURLToPath(new URL("../src/gen/sdk.gen.ts", import.meta.url))

function generatedMethodSource(generated: string, className: string, methodName: string) {
  const classStart = generated.indexOf(`export class ${className} extends HeyApiClient`)
  expect(classStart).toBeGreaterThanOrEqual(0)

  const methodStart = generated.indexOf(`  public ${methodName}<`, classStart)
  expect(methodStart).toBeGreaterThanOrEqual(0)

  const nextMethod = generated.indexOf("\n  /**", methodStart + 1)
  return generated.slice(methodStart, nextMethod === -1 ? undefined : nextMethod)
}

describe("OpenAPI snapshot contract", () => {
  test("is valid JSON with the required SDK routes", () => {
    const snapshot = parseOpenApiSnapshot(readFileSync(openApiSnapshotPath, "utf8"))
    expect(validateOpenApiSnapshot(snapshot)).toEqual([])
  })

  test("guards the cross-language route set", () => {
    expect(REQUIRED_OPENAPI_PATHS).toContain("/global/health")
    expect(REQUIRED_OPENAPI_PATHS).toContain("/event")
    expect(REQUIRED_OPENAPI_PATHS).toContain("/session")
    expect(REQUIRED_OPENAPI_PATHS).toContain("/session/{sessionID}/prompt_async")
    expect(REQUIRED_OPENAPI_PATHS).toContain("/permission/{requestID}/reply")
  })

  test("keeps optional numeric query parameters optional in the generated SDK", () => {
    const generated = readFileSync(generatedSdkPath, "utf8")
    const affectedMethods = [
      {
        className: "PromptHistory",
        methodName: "list",
        optionalParameters: true,
        optional: ["limit?: number"],
        required: ["limit: number"],
      },
      {
        className: "TaskQueue",
        methodName: "list",
        optionalParameters: true,
        optional: ["limit?: number"],
        required: ["limit: number"],
      },
      {
        className: "ScheduledTask",
        methodName: "list",
        optionalParameters: true,
        optional: ["dueBefore?: number", "limit?: number"],
        required: ["dueBefore: number", "limit: number"],
      },
      {
        className: "ScheduledTask",
        methodName: "runDue",
        optionalParameters: true,
        optional: ["now?: number"],
        required: ["now: number"],
      },
      {
        className: "WorkflowRun",
        methodName: "list",
        optionalParameters: true,
        optional: ["limit?: number"],
        required: ["limit: number"],
      },
      {
        className: "WorkflowRun",
        methodName: "dashboard",
        optionalParameters: true,
        optional: ["limit?: number", "now?: number"],
        required: ["limit: number", "now: number"],
      },
      {
        className: "Audit",
        methodName: "export",
        optionalParameters: false,
        optional: ["limit?: number"],
        required: ["limit: number"],
      },
      {
        className: "Audit",
        methodName: "exportAll",
        optionalParameters: true,
        optional: ["limit?: number", "since?: number"],
        required: ["limit: number", "since: number"],
      },
      {
        className: "Audit",
        methodName: "replay",
        optionalParameters: false,
        optional: ["fromStep?: number"],
        required: ["fromStep: number"],
      },
      {
        className: "Find",
        methodName: "files",
        optionalParameters: false,
        optional: ["limit?: number"],
        required: ["limit: number"],
      },
    ]

    for (const method of affectedMethods) {
      const source = generatedMethodSource(generated, method.className, method.methodName)

      if (method.optionalParameters) {
        expect(source).toContain("parameters?: {")
      }
      for (const optional of method.optional) {
        expect(source).toContain(optional)
      }
      for (const required of method.required) {
        expect(source).not.toContain(required)
      }
    }
  })
})
