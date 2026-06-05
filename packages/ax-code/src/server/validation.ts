import { validator as openApiValidator } from "hono-openapi"
import { invalidRequest } from "./error"

export const validator = ((target: any, schema: any, hook?: any, options?: any) =>
  openApiValidator(
    target,
    schema,
    async (result: any, c: any) => {
      const hookResult = await hook?.(result, c)
      if (hookResult) return hookResult
      if (!result.success) return invalidRequest(c)
    },
    options,
  )) as typeof openApiValidator
