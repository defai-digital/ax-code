import { expect, test } from "vitest"

import { buildOperationCodeSample } from "../../src/cli/cmd/generate"

test("generate command code samples use the public AX Code v2 SDK client", () => {
  const sample = buildOperationCodeSample("sessionCreate")

  expect(sample).toContain('import { createAxCodeClient } from "@ax-code/sdk/v2"')
  expect(sample).toContain("const client = createAxCodeClient()")
  expect(sample).toContain("await client.sessionCreate({")
  expect(sample).not.toContain("createOpencodeClient")
  expect(sample).not.toContain('"@ax-code/sdk"')
})
