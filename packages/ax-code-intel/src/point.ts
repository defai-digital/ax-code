import { pathToFileURL } from "url"
import type { LSPClient } from "./client"
import { withTimeout } from "./internal/timeout"
import type { SemanticEnvelope } from "./envelope"
import * as LSPEnvelopeRunner from "./envelope-runner"
import * as LSPPerf from "./perf"
import type { ClientOptions, ClientSelection } from "./selection"
import {
  normalizeCallHierarchyItems,
  normalizeHoverResults,
  normalizeIncomingCalls,
  normalizeNavigationLocations,
  normalizeOutgoingCalls,
} from "./semantic-results"
import type {
  CallHierarchyCall,
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  Hover,
  NavigationLocation,
} from "./semantic-results"

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
): Promise<CallHierarchyItem[]> {
  const result = await requestAtPoint(client, "textDocument/prepareCallHierarchy", input, timeoutMs)
  return normalizeCallHierarchyItems(result)
}

export async function callHierarchyCallsForClient<TCall extends CallHierarchyCall = CallHierarchyCall>(
  client: LSPClient.Info,
  input: PointInput,
  opts: {
    request: string
    timeoutMs: number
    normalize?: (value: unknown) => TCall[]
  },
): Promise<TCall[]> {
  const items = await prepareCallHierarchyItems(client, input, opts.timeoutMs)
  if (!items?.length) return []

  const normalize =
    opts.normalize ??
    ((opts.request === "callHierarchy/incomingCalls" ? normalizeIncomingCalls : normalizeOutgoingCalls) as (
      value: unknown,
    ) => TCall[])
  const calls = await Promise.all(
    items.map((item) =>
      withTimeout(client.connection.sendRequest(opts.request, { item }), opts.timeoutMs).catch(() => undefined),
    ),
  )
  return calls.flatMap((result) => (result === undefined ? [] : normalize(result)))
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

export async function requestSemanticArrayEnvelope<T>(
  input: PointInput,
  opts: {
    metric?: string
    request: string
    operation: string
    method: NonNullable<ClientOptions["method"]>
    dedupKey?: string
    extraParams?: Record<string, unknown>
    normalize: (value: unknown) => T[]
    reduce?: (results: unknown[]) => T[]
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<T[]>> {
  return requestEnvelope(input, {
    metric: opts.metric,
    request: opts.request,
    operation: opts.operation,
    reduce: opts.reduce ?? ((results) => results.flatMap(opts.normalize)),
    empty: [] as T[],
    clientOptions: { mode: "semantic", method: opts.method },
    dedupKey: opts.dedupKey,
    extraParams: opts.extraParams,
    timeoutMs: opts.timeoutMs,
    selectClients: opts.selectClients,
  })
}

export async function callHierarchyCallsEnvelope<TCall extends CallHierarchyCall>(
  input: PointInput,
  opts: {
    metric: string
    request: string
    operation: string
    normalize: (value: unknown) => TCall[]
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<TCall[]>> {
  return LSPPerf.metered(opts.metric, { file: input.file }, async () =>
    LSPEnvelopeRunner.runWithEnvelope({
      file: input.file,
      call: (client) =>
        callHierarchyCallsForClient(client, input, {
          request: opts.request,
          timeoutMs: opts.timeoutMs,
          normalize: opts.normalize,
        }),
      reduce: (results) => results.flat(),
      empty: [] as TCall[],
      operation: opts.operation,
      opts: { mode: "semantic", method: "callHierarchy" },
      selectClients: opts.selectClients,
    }),
  )
}

export function hoverEnvelope(input: PointInput, runtime: PointEnvelopeRuntime): Promise<SemanticEnvelope<Hover[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "hover",
    request: "textDocument/hover",
    operation: "hover",
    normalize: normalizeHoverResults,
    method: "hover",
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

async function envelopeData<T>(envelope: Promise<SemanticEnvelope<T>>): Promise<T> {
  return (await envelope).data
}

export function hover(input: PointInput, runtime: PointEnvelopeRuntime): Promise<Hover[]> {
  return envelopeData(hoverEnvelope(input, runtime))
}

export function definitionEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<NavigationLocation[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "definition",
    request: "textDocument/definition",
    operation: "definition",
    method: "definition",
    normalize: normalizeNavigationLocations,
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function definition(input: PointInput, runtime: PointEnvelopeRuntime): Promise<NavigationLocation[]> {
  return envelopeData(definitionEnvelope(input, runtime))
}

export function implementationEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<NavigationLocation[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "implementation",
    request: "textDocument/implementation",
    operation: "implementation",
    method: "implementation",
    normalize: normalizeNavigationLocations,
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function implementation(input: PointInput, runtime: PointEnvelopeRuntime): Promise<NavigationLocation[]> {
  return envelopeData(implementationEnvelope(input, runtime))
}

export function prepareCallHierarchyEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<CallHierarchyItem[]>> {
  return requestSemanticArrayEnvelope(input, {
    metric: "prepareCallHierarchy",
    request: "textDocument/prepareCallHierarchy",
    operation: "prepareCallHierarchy",
    method: "callHierarchy",
    normalize: normalizeCallHierarchyItems,
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function prepareCallHierarchy(input: PointInput, runtime: PointEnvelopeRuntime): Promise<CallHierarchyItem[]> {
  return envelopeData(prepareCallHierarchyEnvelope(input, runtime))
}

export function incomingCallsEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<CallHierarchyIncomingCall[]>> {
  return callHierarchyCallsEnvelope(input, {
    metric: "incomingCalls",
    request: "callHierarchy/incomingCalls",
    operation: "incomingCalls",
    normalize: normalizeIncomingCalls,
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function incomingCalls(input: PointInput, runtime: PointEnvelopeRuntime): Promise<CallHierarchyIncomingCall[]> {
  return envelopeData(incomingCallsEnvelope(input, runtime))
}

export function outgoingCallsEnvelope(
  input: PointInput,
  runtime: PointEnvelopeRuntime,
): Promise<SemanticEnvelope<CallHierarchyOutgoingCall[]>> {
  return callHierarchyCallsEnvelope(input, {
    metric: "outgoingCalls",
    request: "callHierarchy/outgoingCalls",
    operation: "outgoingCalls",
    normalize: normalizeOutgoingCalls,
    timeoutMs: runtime.timeoutMs,
    selectClients: runtime.selectClients,
  })
}

export function outgoingCalls(input: PointInput, runtime: PointEnvelopeRuntime): Promise<CallHierarchyOutgoingCall[]> {
  return envelopeData(outgoingCallsEnvelope(input, runtime))
}
