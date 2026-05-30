import { afterEach, describe, expect, test } from "bun:test"
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

    const response = await grpcUnary(handle.url, AX_CODE_GRPC_METHOD.GetSession, "SessionRequest", { sessionID: "sess-1" })

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
})

async function grpcUnary(url: string, method: string, requestType: string, request: unknown) {
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
    stream.end(encodeAxCodeGrpcFrame(encodeAxCodeGrpcProtoMessage(requestType, request)))
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
