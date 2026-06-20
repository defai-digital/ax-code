import { afterEach, expect, test, vi } from "vitest"

let registers = 0
let shutdowns = 0

vi.mock("@opentelemetry/sdk-trace-node", () => ({
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

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor(_input: unknown) {}

    async shutdown() {}
  },
}))

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (input: unknown) => input,
}))

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
  ATTR_SERVICE_VERSION: "service.version",
}))

afterEach(async () => {
  const { Telemetry } = await import("../../src/telemetry")
  await Telemetry.shutdown()
  delete process.env.AX_CODE_OTLP_ENDPOINT
  registers = 0
  shutdowns = 0
  vi.restoreAllMocks()
})

test("Telemetry.init deduplicates concurrent initialization", async () => {
  process.env.AX_CODE_OTLP_ENDPOINT = "https://1.1.1.1/v1/traces"

  const { Telemetry } = await import("../../src/telemetry")
  await Promise.all([Telemetry.init(), Telemetry.init(), Telemetry.init()])

  expect(registers).toBe(1)

  await Telemetry.shutdown()
  expect(shutdowns).toBe(1)
})

test("Telemetry.init rejects private OTLP endpoints before exporter setup", async () => {
  process.env.AX_CODE_OTLP_ENDPOINT = "http://127.0.0.1:4318/v1/traces"

  const { Telemetry } = await import("../../src/telemetry")
  await Telemetry.init()

  expect(registers).toBe(0)
})
