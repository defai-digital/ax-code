import { Server } from "../../server/server"
import type { CommandModule } from "yargs"

/** Canonical JSON for the OpenAPI document. Component schema keys are sorted
 * so the emitted spec is stable across module-evaluation order (macOS vs
 * Linux CI). Nested schema fields keep their original key order. */
export function stringifyOpenApi(specs: unknown): string {
  return JSON.stringify(stabilizeOpenApi(specs), null, 2)
}

function stabilizeOpenApi(specs: unknown): unknown {
  if (!isRecord(specs)) return specs
  const components = isRecord(specs.components) ? specs.components : undefined
  const schemas = components && isRecord(components.schemas) ? components.schemas : undefined
  if (!components || !schemas) return specs
  return {
    ...specs,
    components: {
      ...components,
      schemas: sortRecord(schemas),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
}

export function buildOperationCodeSample(operationID: string): string {
  return [
    `import { createAxCodeClient } from "@ax-code/sdk/v2"`,
    ``,
    `const client = createAxCodeClient()`,
    `await client.${operationID}({`,
    `  ...`,
    `})`,
  ].join("\n")
}

export const GenerateCommand = {
  command: "generate",
  handler: async () => {
    const specs = await Server.openapi()
    for (const item of Object.values(specs.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item[method]
        if (!operation?.operationId) continue
        // @ts-expect-error
        operation["x-codeSamples"] = [
          {
            lang: "js",
            source: buildOperationCodeSample(operation.operationId),
          },
        ]
      }
    }
    const json = stringifyOpenApi(specs)

    // Wait for stdout to finish writing before process.exit() is called
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(json, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
} satisfies CommandModule
