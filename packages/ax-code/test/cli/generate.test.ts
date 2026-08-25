import { expect, test } from "vitest"

import { buildOperationCodeSample, stringifyOpenApi } from "../../src/cli/cmd/generate"

test("generate command code samples use the public AX Code v2 SDK client", () => {
  const sample = buildOperationCodeSample("sessionCreate")

  expect(sample).toContain('import { createAxCodeClient } from "@ax-code/sdk/v2"')
  expect(sample).toContain("const client = createAxCodeClient()")
  expect(sample).toContain("await client.sessionCreate({")
  expect(sample).not.toContain("createOpencodeClient")
  expect(sample).not.toContain('"@ax-code/sdk"')
})

test("stringifyOpenApi sorts component schema keys independently of insertion order", () => {
  const first = stringifyOpenApi({
    openapi: "3.1.0",
    components: { schemas: { Zeta: { type: "string" }, Alpha: { type: "number" } } },
  })
  const second = stringifyOpenApi({
    openapi: "3.1.0",
    components: { schemas: { Alpha: { type: "number" }, Zeta: { type: "string" } } },
  })
  expect(first).toBe(second)
  expect(first.indexOf('"Alpha"')).toBeLessThan(first.indexOf('"Zeta"'))
})
