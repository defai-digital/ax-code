import { afterEach, expect, test, vi } from "vitest"

let registers = 0
let shutdowns = 0

type FakeSpan = {
  name: string
  startTime: unknown
  endTime: unknown
  attributes: Record<string, unknown>
  setAttribute: (key: string, value: unknown) => void
  setStatus: () => void
  end: (endTime?: unknown) => void
}

let capturedSpans: FakeSpan[] = []
let bySessionWithTimestampMock = vi.fn()

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startSpan: (name: string, options?: { startTime?: unknown }) => {
        const span: FakeSpan = {
          name,
          startTime: options?.startTime,
          endTime: undefined,
          attributes: {},
          setAttribute(key, value) {
            span.attributes[key] = value
          },
          setStatus() {},
          end(endTime) {
            span.endTime = endTime
          },
        }
        capturedSpans.push(span)
        return span
      },
    }),
    setSpan: (ctx: unknown, span: unknown) => ({ ctx, span }),
  },
  context: {
    active: () => ({}),
  },
}))

vi.mock("@/replay/query", () => ({
  EventQuery: {
    bySessionWithTimestamp: (...args: unknown[]) => bySessionWithTimestampMock(...args),
  },
}))

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
  capturedSpans = []
  bySessionWithTimestampMock = vi.fn()
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

test("Telemetry.exportSession uses recorded event timestamps, not export-time `now`", async () => {
  process.env.AX_CODE_OTLP_ENDPOINT = "https://1.1.1.1/v1/traces"
  const { Telemetry } = await import("../../src/telemetry")
  await Telemetry.init()

  const sessionID = "ses_test" as never
  const T0 = 1_000
  const T1 = 2_000
  const T2 = 3_000
  const T3 = 4_000
  const T4 = 5_000
  const T5 = 6_000

  bySessionWithTimestampMock.mockReturnValue([
    { time_created: T0, event_data: { type: "session.start", sessionID, agent: "build", model: "m", directory: "/" } },
    { time_created: T1, event_data: { type: "step.start", sessionID, stepIndex: 0 } },
    { time_created: T2, event_data: { type: "tool.call", sessionID, stepIndex: 0, callID: "c1", tool: "read" } },
    {
      time_created: T3,
      event_data: { type: "tool.result", sessionID, stepIndex: 0, callID: "c1", status: "success", durationMs: 1_000 },
    },
    {
      time_created: T4,
      event_data: {
        type: "step.finish",
        sessionID,
        stepIndex: 0,
        finishReason: "stop",
        tokens: { input: 10, output: 20 },
      },
    },
    { time_created: T5, event_data: { type: "session.end", sessionID, reason: "completed", totalSteps: 1 } },
  ])

  await Telemetry.exportSession(sessionID)

  const session = capturedSpans.find((span) => span.name === "session")
  const step = capturedSpans.find((span) => span.name === "step.0")
  const tool = capturedSpans.find((span) => span.name === "tool.read")

  // Every span must be timed from the historical event it represents — not
  // from whenever this batch export happened to run — otherwise the
  // exported trace shows zero-duration, simultaneous spans and all
  // durations/latencies are lost.
  expect(session?.startTime).toBe(T0)
  expect(session?.endTime).toBe(T5)
  expect(step?.startTime).toBe(T1)
  expect(step?.endTime).toBe(T4)
  expect(tool?.startTime).toBe(T2)
  expect(tool?.endTime).toBe(T3)
})
