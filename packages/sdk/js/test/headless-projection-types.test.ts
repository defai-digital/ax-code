import { resolve } from "node:path"
import ts from "typescript"
import { describe, expect, test } from "vitest"
import { HEADLESS_RUNTIME_EVENT_TYPES } from "../src/headless.js"

const PACKAGE_ROOT = resolve(import.meta.dirname, "..")

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2024.d.ts", "lib.esnext.array.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: ["node"],
  typeRoots: [resolve(PACKAGE_ROOT, "node_modules/@types")],
  paths: {
    "@ax-code/sdk/headless": [resolve(PACKAGE_ROOT, "src/headless.ts")],
    "@ax-code/sdk/v2": [resolve(PACKAGE_ROOT, "src/v2/index.ts")],
  },
}

// Generated event payloads that are not assignable to their headless runtime
// counterpart. Each is handled locally without storing an unsound value.
const WORKFLOW_EVENT_TYPES = [
  "workflow.run.created",
  "workflow.run.updated",
  "workflow.run.started",
  "workflow.run.blocked",
  "workflow.run.paused",
  "workflow.run.resumed",
  "workflow.run.completed",
  "workflow.run.failed",
  "workflow.run.cancelled",
  "workflow.phase.updated",
  "workflow.phase.started",
  "workflow.phase.completed",
  "workflow.phase.failed",
  "workflow.child.created",
  "workflow.child.updated",
  "workflow.child.started",
  "workflow.child.completed",
  "workflow.child.failed",
  "workflow.child.cancelled",
  "workflow.artifact.written",
  "workflow.budget.appended",
  "workflow.budget.warning",
  "workflow.budget.exceeded",
  "workflow.verification.attached",
]

const PAYLOAD_EXCEPTIONS = new Map<string, string>([
  [
    "session.error",
    "isHeadlessRuntimeEvent accepts by type; session_error stores unknown, so an omitted error stays a valid value",
  ],
  ["vcs.branch.updated", "a typeof branch === 'string' guard clears vcs when the generated payload omits branch"],
  [
    "server.connected",
    "isHeadlessRuntimeEvent accepts by type; the handler sets stream health and never reads properties",
  ],
  [
    "server.heartbeat",
    "isHeadlessRuntimeEvent accepts by type; the handler sets stream health and never reads properties",
  ],
  ...WORKFLOW_EVENT_TYPES.map((type): [string, string] => [
    type,
    "isHeadlessRuntimeEvent accepts by type; the handler emits a probe and never reads properties",
  ]),
])

function buildTypeSource(): string {
  const checks = [...HEADLESS_RUNTIME_EVENT_TYPES]
    .sort()
    .map((type, index) => {
      const exception = PAYLOAD_EXCEPTIONS.get(type)
      if (exception) return `// exception ${type}: ${exception}`
      const quoted = JSON.stringify(type)
      return [
        `type Generated_${index} = Extract<Event, { type: ${quoted} }>`,
        `type Runtime_${index} = Extract<HeadlessRuntimeEvents, { type: ${quoted} }>`,
        `type Assignable_${index} = [Generated_${index}] extends [Runtime_${index}] ? true : ${quoted}`,
        `const assignable_${index}: true = null as any as Assignable_${index}`,
      ].join("\n")
    })
    .join("\n")

  return `
import {
  applyHeadlessProjectionEvent,
  createHeadlessClientProjectionState,
  createHeadlessProjectionState,
  isHeadlessRuntimeEvent,
} from "@ax-code/sdk/headless"
import type { HeadlessRuntimeEvent } from "@ax-code/sdk/headless"
import type {
  Event,
  EventSessionCreated,
  FileDiff,
  Message,
  Part,
  Session,
  SessionStatus,
  Todo,
} from "@ax-code/sdk/v2"

type HeadlessRuntimeEvents = HeadlessRuntimeEvent<
  Session,
  Todo,
  FileDiff,
  SessionStatus,
  Message,
  Part,
  unknown,
  { id: string }
>

type CustomSession = { id: string; custom: string }
type CustomMessage = { id: string; sessionID: string }
type CustomPart = { id: string; messageID: string }

const customState = createHeadlessProjectionState<CustomSession, unknown, unknown, unknown, CustomMessage, CustomPart>()

// Custom-typed states still accept matching custom events.
applyHeadlessProjectionEvent(customState, {
  type: "session.created",
  properties: { info: { id: "s", custom: "value" } },
})

declare const generatedSessionCreated: EventSessionCreated

// @ts-expect-error a generated session event cannot satisfy a custom state
applyHeadlessProjectionEvent(customState, generatedSessionCreated)

// No-argument construction infers the constraint types again.
const inferred = createHeadlessProjectionState()
inferred.session.push({ id: "s" })
inferred.session_status["s"] = "idle"

// The client projection accepts generated events and types its status map.
const clientState = createHeadlessClientProjectionState()
applyHeadlessProjectionEvent(clientState, generatedSessionCreated)
declare const generatedEvent: Event
applyHeadlessProjectionEvent(clientState, generatedEvent)
const typedStatus: "idle" | "busy" | "retry" | undefined = clientState.session_status["s"]?.type
void typedStatus

// Every generated member of a headless event type must be assignable to the
// runtime member; a failure names the offending type.
${checks}

// The exported guard stays a plain boolean, so it does not narrow a generated
// Event union and optional fields such as vcs.branch stay optional.
function handle(event: Event) {
  if (isHeadlessRuntimeEvent(event)) return
  switch (event.type) {
    case "session.created":
      void event.properties.info.id
      break
    case "vcs.branch.updated": {
      const branch: string | undefined = event.properties.branch
      void branch
      break
    }
  }
}
void handle

// A runtime-typed task queue event cannot smuggle an unknown item into the client state.
// @ts-expect-error item must match the state's task queue item type
applyHeadlessProjectionEvent(createHeadlessClientProjectionState(), { type: "task.queue.created", properties: { item: 123 } } as HeadlessRuntimeEvent<Session, Todo, FileDiff, SessionStatus, Message, Part>)
`
}

const SOURCE = buildTypeSource()

function check(source: string): string[] {
  const fileName = resolve(PACKAGE_ROOT, "__headless_projection_types__.ts")
  const host = ts.createCompilerHost(COMPILER_OPTIONS)
  const getSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const readFile = host.readFile.bind(host)
  host.fileExists = (name) => name === fileName || fileExists(name)
  host.readFile = (name) => (name === fileName ? source : readFile(name))
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === fileName
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)

  const program = ts.createProgram([fileName], COMPILER_OPTIONS, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || diagnostic.file.fileName === fileName)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
}

describe("headless projection types", () => {
  test("every payload exception names a known headless runtime event", () => {
    expect([...PAYLOAD_EXCEPTIONS.keys()].filter((type) => !HEADLESS_RUNTIME_EVENT_TYPES.has(type))).toEqual([])
  })

  test("custom states stay strict while the client projection accepts generated events", () => {
    expect(check(SOURCE)).toEqual([])
  })
})
