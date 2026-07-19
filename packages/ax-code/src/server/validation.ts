import { validator as openApiValidator } from "hono-openapi"
import { invalidRequest } from "./error"

export const validator: typeof openApiValidator = (target, schema, hook, options) =>
  openApiValidator(
    target,
    schema,
    async (result, c) => {
      const hookResult = await hook?.(result, c as never)
      if (hookResult) return hookResult
      if (!result.success) return invalidRequest(c)
    },
    options,
  ) as never
