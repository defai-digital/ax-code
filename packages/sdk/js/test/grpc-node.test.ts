import { afterEach, describe, expect, test } from "vitest"
import { connect } from "node:http2"
import { AX_CODE_GRPC_METHOD } from "../src/grpc"
import {
  decodeAxCodeGrpcFrames,
  decodeAxCodeGrpcProtoMessage,
  encodeAxCodeGrpcFrame,
  encodeAxCodeGrpcProtoMessage,
  startAxCodeGrpcNodeHttp2Server,
  type AxCodeGrpcNodeHttp2ServerHandle,
} from "../src/grpc-node"

describe("gRPC Node HTTP/2 host", () => {
  let handle: AxCodeGrpcNodeHttp2ServerHandle | undefined

  afterEach(async () => {
    await handle?.close()
    handle = undefined
  })

  test("rejects non-loopback hosts", async () => {
    await expect(
      startAxCodeGrpcNodeHttp2Server({
        host: "0.0.0.0",
        bridge: {
          async unary() {
            return { status: "SERVING" }
          },
        },
      }),
    ).rejects.toThrow("local-only")
  })

  test("serves unary protobuf calls over HTTP/2", async () => {
    const calls: unknown[] = []
    handle = await startAxCodeGrpcNodeHttp2Server({
      bridge: {
        async unary(call) {
          calls.push(call)
          if (call.method === AX_CODE_GRPC_METHOD.Health) return { status: "SERVING" }
          return { value: { id: (call.request as { sessionID: string }).sessionID, nested: { ok: true }, tags: ["a"] } }
        },
      },
    })

    const response = await grpcUnary(handle.url, AX_CODE_GRPC_METHOD.GetSession, "SessionRequest", {
      sessionID: "sess-1",
    })

    expect(decodeAxCodeGrpcProtoMessage("JsonResponse", response.messages[0]!)).toEqual({
      value: { id: "sess-1", nested: { ok: true }, tags: ["a"] },
    })
    expect(response.grpcStatus).toBe("0")
    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.GetSession,
        request: { sessionID: "sess-1" },
        metadata: {},
      },
    ])
  })

  test("serves server streaming protobuf calls over HTTP/2", async () => {
    const calls: unknown[] = []
    handle = await startAxCodeGrpcNodeHttp2Server({
      bridge: {
        async unary() {
          return { status: "SERVING" }
        },
        async *serverStream(call) {
          calls.push(call)
          yield { type: "session.updated", properties: { sessionID: "sess-1", count: 1 } }
          yield { type: "server.heartbeat", properties: { ok: true } }
        },
      },
    })

    const response = await grpcUnary(handle.url, AX_CODE_GRPC_METHOD.SubscribeEvents, "SubscribeEventsRequest", {
      types: ["session.updated"],
      sessionID: "sess-1",
    })

    expect(response.messages.map((message) => decodeAxCodeGrpcProtoMessage("RuntimeEvent", message))).toEqual([
      { type: "session.updated", properties: { sessionID: "sess-1", count: 1 } },
      { type: "server.heartbeat", properties: { ok: true } },
    ])
    expect(response.grpcStatus).toBe("0")
    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.SubscribeEvents,
        request: { types: ["session.updated"], sessionID: "sess-1" },
        metadata: {},
      },
    ])
  })

  test("reports a mid-stream server-streaming failure as a non-OK trailer", async () => {
    handle = await startAxCodeGrpcNodeHttp2Server({
      bridge: {
        async unary() {
          return { status: "SERVING" }
        },
        async *serverStream() {
          yield { type: "session.updated", properties: { sessionID: "sess-1", count: 1 } }
          throw new Error("stream boom")
        },
      },
    })

    const response = await grpcUnary(handle.url, AX_CODE_GRPC_METHOD.SubscribeEvents, "SubscribeEventsRequest", {
      types: ["session.updated"],
      sessionID: "sess-1",
    })

    // The first event is delivered, then the mid-stream throw must surface as
    // grpc-status 13 (INTERNAL) rather than the false success (0) that the
    // unconditional wantTrailers handler used to send.
    expect(response.messages.map((message) => decodeAxCodeGrpcProtoMessage("RuntimeEvent", message))).toEqual([
      { type: "session.updated", properties: { sessionID: "sess-1", count: 1 } },
    ])
    expect(response.grpcStatus).toBe("13")
  })

  test("preserves empty-string struct keys through encode/decode", () => {
    // A struct entry whose key is "" must survive the round-trip; the decoder
    // previously dropped it by testing key truthiness instead of presence.
    const message = { value: { "": 123, normal: 1, nested: { "": "kept" } } }
    const encoded = encodeAxCodeGrpcProtoMessage("JsonResponse", message)
    expect(decodeAxCodeGrpcProtoMessage("JsonResponse", encoded)).toEqual(message)
  })

  test("serves bidirectional PTY protobuf streams over HTTP/2", async () => {
    const calls: unknown[] = []
    handle = await startAxCodeGrpcNodeHttp2Server({
      bridge: {
        async unary() {
          return { status: "SERVING" }
        },
        async *bidiStream(call) {
          calls.push({ method: call.method, request: call.request, metadata: call.metadata })
          for await (const event of call.input) calls.push(event)
          yield { type: "output", data: "ready" }
          yield { type: "replay", cursor: 7, from: 3, gap: { requested: 1, available: 3 } }
        },
      },
    })

    const response = await grpcStream(handle.url, AX_CODE_GRPC_METHOD.ConnectPty, "PtyClientEvent", [
      { ptyID: "pty-1", cursor: 5 },
      { type: "input", data: "pwd\n" },
      { type: "resize", cols: 120, rows: 40 },
    ])

    expect(response.messages.map((message) => decodeAxCodeGrpcProtoMessage("PtyServerEvent", message))).toEqual([
      { type: "output", data: "ready" },
      { type: "replay", cursor: 7, from: 3, gap: { requested: 1, available: 3 } },
    ])
    expect(response.grpcStatus).toBe("0")
    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.ConnectPty,
        request: { id: "pty-1", cursor: 5 },
        metadata: {},
      },
      { type: "input", data: "pwd\n" },
      { type: "resize", cols: 120, rows: 40 },
    ])
  })
})

async function grpcUnary(url: string, method: string, requestType: string, request: unknown) {
  return grpcStream(url, method, requestType, [request])
}

async function grpcStream(url: string, method: string, requestType: string, requests: unknown[]) {
  const session = connect(url)
  try {
    const stream = session.request({
      ":method": "POST",
      ":path": method,
      "content-type": "application/grpc+proto",
      te: "trailers",
    })
    const chunks: Uint8Array[] = []
    let grpcStatus: string | undefined
    stream.on("response", (headers) => {
      const value = headers["grpc-status"]
      grpcStatus = Array.isArray(value) ? value[0] : value?.toString()
    })
    stream.on("trailers", (headers) => {
      const value = headers["grpc-status"]
      grpcStatus = Array.isArray(value) ? value[0] : value?.toString()
    })
    stream.on("data", (chunk) => chunks.push(new Uint8Array(chunk)))
    const ended = new Promise<void>((resolve, reject) => {
      stream.on("end", resolve)
      stream.on("error", reject)
    })
    for (const request of requests) {
      stream.write(encodeAxCodeGrpcFrame(encodeAxCodeGrpcProtoMessage(requestType, request)))
    }
    stream.end()
    await ended
    return {
      grpcStatus,
      messages: decodeAxCodeGrpcFrames(concatBytes(chunks)),
    }
  } finally {
    session.close()
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
