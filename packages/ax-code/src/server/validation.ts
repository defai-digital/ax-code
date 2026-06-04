import { validator as openApiValidator } from "hono-openapi"
import type { AppErrorEnvelope } from "./error"

const VALIDATION_ERROR: AppErrorEnvelope = {
  name: "InvalidRequestError",
  message: "Invalid request",
  status: 400,
}

export const validator = ((target: any, schema: any, hook?: any, options?: any) =>
  openApiValidator(
    target,
    schema,
    async (result: any, c: any) => {
      const hookResult = await hook?.(result, c)
      if (hookResult) return hookResult
      if (!result.success) return c.json(VALIDATION_ERROR, 400)
    },
    options,
  )) as typeof openApiValidator
