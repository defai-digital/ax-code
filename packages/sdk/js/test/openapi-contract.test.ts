import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import {
  REQUIRED_OPENAPI_PATHS,
  parseOpenApiSnapshot,
  validateOpenApiSnapshot,
} from "../src/openapi/contract"

const openApiSnapshotPath = fileURLToPath(new URL("../../openapi.json", import.meta.url))

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
})
