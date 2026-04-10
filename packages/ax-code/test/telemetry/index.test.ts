import { afterEach, expect, mock, test } from "bun:test"

let registers = 0
let shutdowns = 0

mock.module("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: class {
    register() {
      registers++
    }

    async shutdown() {
      shutdowns++
    }
  },
  SimpleSpanProcessor: class {
    constructor(_exporter: unknown) {}
  },
}))

mock.module("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor(_input: unknown) {}

    async shutdown() {}
  },
}))

mock.module("@opentelemetry/resources", () => ({
  resourceFromAttributes: (input: unknown) => input,
}))

mock.module("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
  ATTR_SERVICE_VERSION: "service.version",
}))

afterEach(async () => {
  const { Telemetry } = await import("../../src/telemetry")
  await Telemetry.shutdown()
  delete process.env.AX_CODE_OTLP_ENDPOINT
  registers = 0
  shutdowns = 0
  mock.restore()
})

test("Telemetry.init deduplicates concurrent initialization", async () => {
  process.env.AX_CODE_OTLP_ENDPOINT = "https://otel.example.com/v1/traces"

  const { Telemetry } = await import("../../src/telemetry")
  await Promise.all([Telemetry.init(), Telemetry.init(), Telemetry.init()])

  expect(registers).toBe(1)

  await Telemetry.shutdown()
  expect(shutdowns).toBe(1)
})
