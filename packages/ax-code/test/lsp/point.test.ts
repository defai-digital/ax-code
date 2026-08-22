import { expect, test } from "vitest"
import {
  callHierarchyCallsEnvelope,
  callHierarchyCallsForClient,
  hover,
  hoverEnvelope,
  incomingCallsEnvelope,
  pointRequestParams,
  requestEnvelope,
  requestSemanticArrayEnvelope,
  textDocumentPositionParams,
} from "@ax-code/ax-code-intel/point"
import type { LSPClient } from "@ax-code/ax-code-intel/client"
import { normalizeIncomingCalls, normalizeNavigationLocations } from "@ax-code/ax-code-intel/semantic-results"

const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 3 },
}

function hierarchyItem(name: string) {
  return {
    name,
    kind: 12,
    uri: `file:///tmp/project/src/${name}.ts`,
    range,
    selectionRange: range,
  }
}

function incomingCall(name: string) {
  return {
    from: hierarchyItem(name),
    fromRanges: [range],
  }
}

function clientWithResponses(responses: Record<string, unknown>): LSPClient.Info {
  return {
    connection: {
      sendRequest(method: string, params: unknown) {
        const response = responses[method]
        return Promise.resolve(typeof response === "function" ? response(params) : response)
      },
    },
  } as LSPClient.Info
}

test("textDocumentPositionParams builds file URI position payloads", () => {
  expect(textDocumentPositionParams({ file: "/tmp/project/src/index.ts", line: 3, character: 7 })).toEqual({
    textDocument: { uri: "file:///tmp/project/src/index.ts" },
    position: { line: 3, character: 7 },
  })
})

test("pointRequestParams merges extra request params after position params", () => {
  expect(
    pointRequestParams(
      { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
      { context: { includeDeclaration: true } },
    ),
  ).toEqual({
    textDocument: { uri: "file:///tmp/project/src/index.ts" },
    position: { line: 1, character: 2 },
    context: { includeDeclaration: true },
  })
})

test("callHierarchyCallsForClient prepares items then flattens call results", async () => {
  const client = clientWithResponses({
    "textDocument/prepareCallHierarchy": [hierarchyItem("caller"), hierarchyItem("callee")],
    "callHierarchy/incomingCalls": (params: { item: { name: string } }) => [incomingCall(params.item.name)],
  })

  await expect(
    callHierarchyCallsForClient(
      client,
      { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
      {
        request: "callHierarchy/incomingCalls",
        timeoutMs: 1_000,
      },
    ),
  ).resolves.toEqual([incomingCall("caller"), incomingCall("callee")])
})

test("callHierarchyCallsForClient returns empty when prepare has no items", async () => {
  const client = clientWithResponses({
    "textDocument/prepareCallHierarchy": [],
  })

  await expect(
    callHierarchyCallsForClient(
      client,
      { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
      {
        request: "callHierarchy/outgoingCalls",
        timeoutMs: 1_000,
      },
    ),
  ).resolves.toEqual([])
})

test("requestEnvelope returns empty metadata when no client matches", async () => {
  const envelope = await requestEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      request: "textDocument/hover",
      operation: "hover",
      reduce: (results) => results,
      empty: [] as unknown[],
      clientOptions: { mode: "semantic", method: "hover" },
      timeoutMs: 1_000,
      selectClients: async () => ({ clients: [], freshSpawnCount: 0 }),
    },
  )

  expect(envelope).toMatchObject({
    data: [],
    source: "lsp",
    completeness: "empty",
    serverIDs: [],
    degraded: false,
  })
})

test("requestSemanticArrayEnvelope applies semantic method defaults and flattens results", async () => {
  const client = {
    ...clientWithResponses({
      "textDocument/definition": [{ uri: "file:///tmp/project/src/target.ts", range }, null],
    }),
    serverID: "fake",
  }
  let selectedOptions: unknown

  const envelope = await requestSemanticArrayEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      metric: "definition",
      request: "textDocument/definition",
      operation: "definition",
      method: "definition",
      normalize: normalizeNavigationLocations,
      timeoutMs: 1_000,
      selectClients: async (_file, opts) => {
        selectedOptions = opts
        return { clients: [client], freshSpawnCount: 0 }
      },
    },
  )

  expect(selectedOptions).toEqual({ mode: "semantic", method: "definition" })
  expect(envelope.data).toEqual([{ uri: "file:///tmp/project/src/target.ts", range }])
  expect(envelope.completeness).toBe("full")
  expect(envelope.serverIDs).toEqual(["fake"])
})

test("hoverEnvelope owns hover request defaults and filters empty responses", async () => {
  const client = {
    ...clientWithResponses({
      "textDocument/hover": { contents: "ok" },
    }),
    serverID: "fake",
  }
  let selectedOptions: unknown

  const envelope = await hoverEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      timeoutMs: 1_000,
      selectClients: async (_file, opts) => {
        selectedOptions = opts
        return { clients: [client], freshSpawnCount: 0 }
      },
    },
  )

  expect(selectedOptions).toEqual({ mode: "semantic", method: "hover" })
  expect(envelope.data).toEqual([{ contents: "ok" }])
  expect(envelope.completeness).toBe("full")
})

test("hover returns only hover envelope data", async () => {
  const client = {
    ...clientWithResponses({
      "textDocument/hover": { contents: "ok" },
    }),
    serverID: "fake",
  }

  await expect(
    hover(
      { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
      {
        timeoutMs: 1_000,
        selectClients: async () => ({ clients: [client], freshSpawnCount: 0 }),
      },
    ),
  ).resolves.toEqual([{ contents: "ok" }])
})

test("callHierarchyCallsEnvelope delegates through selected clients", async () => {
  const client = {
    ...clientWithResponses({
      "textDocument/prepareCallHierarchy": [hierarchyItem("caller")],
      "callHierarchy/incomingCalls": (params: { item: { name: string } }) => [incomingCall(params.item.name)],
    }),
    serverID: "fake",
  }

  const envelope = await callHierarchyCallsEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      metric: "incomingCalls",
      request: "callHierarchy/incomingCalls",
      operation: "incomingCalls",
      normalize: normalizeIncomingCalls,
      timeoutMs: 1_000,
      selectClients: async () => ({ clients: [client], freshSpawnCount: 0 }),
    },
  )

  expect(envelope.data).toEqual([incomingCall("caller")])
  expect(envelope.completeness).toBe("full")
  expect(envelope.serverIDs).toEqual(["fake"])
})

test("incomingCallsEnvelope owns incoming call hierarchy defaults", async () => {
  const client = {
    ...clientWithResponses({
      "textDocument/prepareCallHierarchy": [hierarchyItem("caller")],
      "callHierarchy/incomingCalls": (params: { item: { name: string } }) => [incomingCall(params.item.name)],
    }),
    serverID: "fake",
  }
  let selectedOptions: unknown

  const envelope = await incomingCallsEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      timeoutMs: 1_000,
      selectClients: async (_file, opts) => {
        selectedOptions = opts
        return { clients: [client], freshSpawnCount: 0 }
      },
    },
  )

  expect(selectedOptions).toEqual({ mode: "semantic", method: "callHierarchy" })
  expect(envelope.data).toEqual([incomingCall("caller")])
})
