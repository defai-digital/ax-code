export const REQUIRED_OPENAPI_PATHS = [
  "/global/health",
  "/event",
  "/session",
  "/session/{sessionID}",
  "/session/{sessionID}/prompt_async",
  "/permission",
  "/permission/{requestID}/reply",
  "/provider",
] as const

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head"] as const

type OpenApiDocument = {
  openapi?: unknown
  info?: unknown
  paths?: unknown
}

type OpenApiOperation = {
  operationId?: unknown
  responses?: unknown
}

export function parseOpenApiSnapshot(source: string): unknown {
  return JSON.parse(source)
}

export function validateOpenApiSnapshot(input: unknown): string[] {
  const errors: string[] = []
  const doc = asRecord(input) as OpenApiDocument | undefined

  if (!doc) {
    return ["OpenAPI snapshot must be a JSON object"]
  }

  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.")) {
    errors.push("OpenAPI snapshot must declare an openapi 3.x version")
  }

  if (!asRecord(doc.info)) {
    errors.push("OpenAPI snapshot must include an info object")
  }

  const paths = asRecord(doc.paths)
  if (!paths) {
    errors.push("OpenAPI snapshot must include a paths object")
    return errors
  }

  for (const path of REQUIRED_OPENAPI_PATHS) {
    const item = asRecord(paths[path])
    if (!item) {
      errors.push(`OpenAPI snapshot is missing required path: ${path}`)
      continue
    }

    const operations = HTTP_METHODS.flatMap((method) => {
      const operation = asRecord(item[method]) as OpenApiOperation | undefined
      return operation ? [{ method, operation }] : []
    })

    if (operations.length === 0) {
      errors.push(`OpenAPI path ${path} must define at least one HTTP operation`)
      continue
    }

    for (const { method, operation } of operations) {
      if (typeof operation.operationId !== "string" || operation.operationId.length === 0) {
        errors.push(`OpenAPI operation ${method.toUpperCase()} ${path} must include operationId`)
      }
      if (!asRecord(operation.responses)) {
        errors.push(`OpenAPI operation ${method.toUpperCase()} ${path} must include responses`)
      }
    }
  }

  return errors
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}
