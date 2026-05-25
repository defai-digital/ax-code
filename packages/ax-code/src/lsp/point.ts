import { pathToFileURL } from "url"
import type { LSPClient } from "./client"
import { withTimeout } from "../util/timeout"
import type { SemanticEnvelope } from "./envelope"
import * as LSPEnvelopeRunner from "./envelope-runner"
import * as LSPPerf from "./perf"
import type { ClientOptions, ClientSelection } from "./selection"

export interface PointInput {
  file: string
  line: number
  character: number
}

type SelectClients = (file: string, opts: ClientOptions) => Promise<ClientSelection>

type PointEnvelopeRuntime = {
  timeoutMs: number
  selectClients: SelectClients
}

export function textDocumentPositionParams(input: PointInput) {
  return {
    textDocument: { uri: pathToFileURL(input.file).href },
    position: { line: input.line, character: input.character },
  }
}

export function pointRequestParams(
  input: PointInput,
  extraParams?: Record<string, unknown>,
): ReturnType<typeof textDocumentPositionParams> & Record<string, unknown> {
  return {
    ...textDocumentPositionParams(input),
    ...extraParams,
  }
}

export async function requestAtPoint(
  client: LSPClient.Info,
  request: string,
  input: PointInput,
  timeoutMs: number,
  extraParams?: Record<string, unknown>,
): Promise<unknown> {
  return withTimeout(client.connection.sendRequest(request, pointRequestParams(input, extraParams)), timeoutMs)
}

export async function prepareCallHierarchyItems(
  client: LSPClient.Info,
  input: PointInput,
  timeoutMs: number,
): Promise<unknown[]> {
  return (await requestAtPoint(client, "textDocument/prepareCallHierarchy", input, timeoutMs)) as unknown[]
}

export async function callHierarchyCallsForClient(
  client: LSPClient.Info,
  input: PointInput,
  opts: {
    request: string
    timeoutMs: number
  },
): Promise<unknown[]> {
  const items = await prepareCallHierarchyItems(client, input, opts.timeoutMs)
  if (!items?.length) return []

  const calls = await Promise.all(
    items.map((item) =>
      withTimeout(client.connection.sendRequest(opts.request, { item }), opts.timeoutMs).catch(() => [] as unknown[]),
    ),
  )
  return calls.flat()
}

export async function requestEnvelope<TPayload>(
  input: PointInput,
  opts: {
    metric?: string
    request: string
    operation: string
    reduce: (results: unknown[]) => TPayload
    empty: TPayload
    clientOptions: ClientOptions
    dedupKey?: string
    extraParams?: Record<string, unknown>
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<TPayload>> {
  const execute = () =>
    LSPEnvelopeRunner.runWithEnvelope({
      file: input.file,
      call: (client) =>
        requestAtPoint(client, opts.request, input, opts.timeoutMs, opts.extraParams) as Promise<unknown>,
      reduce: opts.reduce,
      empty: opts.empty,
      operation: opts.operation,
      dedupKey: opts.dedupKey,
      opts: opts.clientOptions,
      selectClients: opts.selectClients,
    })
  if (!opts.metric) return execute()
  return LSPPerf.metered(opts.metric, { file: input.file }, execute)
}

export async function requestSemanticArrayEnvelope(
  input: PointInput,
  opts: {
    metric?: string
    request: string
    operation: string
    method: NonNullable<ClientOptions["method"]>
    dedupKey?: string
    extraParams?: Record<string, unknown>
    reduce?: (results: unknown[]) => unknown[]
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<unknown[]>> {
  return requestEnvelope(input, {
    metric: opts.metric,
    request: opts.request,
    operation: opts.operation,
    reduce: opts.reduce ?? ((results) => results.flat().filter(Boolean)),
    empty: [] as unknown[],
    clientOptions: { mode: "semantic", method: opts.method },
    dedupKey: opts.dedupKey,
    extraParams: opts.extraParams,
    timeoutMs: opts.timeoutMs,
    selectClients: opts.selectClients,
  })
}

export async function callHierarchyCallsEnvelope(
  input: PointInput,
  opts: {
    metric: string
    request: string
    operation: string
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<unknown[]>> {
  return LSPPerf.metered(opts.metric, { file: input.file }, async () =>
    LSPEnvelopeRunner.runWithEnvelope({
      file: input.file,
      call: (client) =>
        callHierarchyCallsForClient(client, input, {
          request: opts.request,
          timeoutMs: opts.timeoutMs,
        }),
      reduce: (results) => (results as unknown[]).flat().filter(Boolean),
      empty: [] as unknown[],
      operation: opts.operation,
      opts: { mode: "semantic", method: "callHierarchy" },
      selectClients: opts.selectClients,
    }),
  )
}

export function hoverEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<unknown[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "hover",
    request: "textDocument/hover",
    operation: "hover",
    reduce: (results) => results.filter((r) => r !== null && r !== undefined),
    method: "hover",
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function definitionEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<unknown[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "definition",
    request: "textDocument/definition",
    operation: "definition",
    method: "definition",
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function implementationEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<unknown[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "implementation",
    request: "textDocument/implementation",
    operation: "implementation",
    method: "implementation",
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function prepareCallHierarchyEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<unknown[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "prepareCallHierarchy",
    request: "textDocument/prepareCallHierarchy",
    operation: "prepareCallHierarchy",
    method: "callHierarchy",
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function incomingCallsEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<unknown[]>> {
  return callHierarchyCallsEnvelope(input, {
    metric: "incomingCalls",
    request: "callHierarchy/incomingCalls",
    operation: "incomingCalls",
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function outgoingCallsEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<unknown[]>> {
  return callHierarchyCallsEnvelope(input, {
    metric: "outgoingCalls",
    request: "callHierarchy/outgoingCalls",
    operation: "outgoingCalls",
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}
