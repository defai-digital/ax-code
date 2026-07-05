import type * as Http2 from "node:http2"
import { errorMessage } from "./internal/error.js"
import {
  type AxCodeGrpcBidirectionalStreamingMethod,
  type AxCodeGrpcMetadata,
  type AxCodeGrpcMethod,
  type AxCodeGrpcNativeBridge,
  type AxCodeGrpcPtyClientEvent,
  type AxCodeGrpcPtyConnectRequest,
  type AxCodeGrpcStreamingMethod,
  type AxCodeGrpcUnaryMethod,
  assertAxCodeGrpcMethodSupported,
} from "./grpc.js"

export type AxCodeGrpcNodeHttp2ServerOptions = {
  bridge: AxCodeGrpcNativeBridge
  host?: string
  port?: number
}

export type AxCodeGrpcNodeHttp2ServerHandle = {
  url: string
  server: Http2.Http2Server
  close(): Promise<void>
}

type ProtoFieldKind = "string" | "uint32" | "int32" | "bool" | "struct" | "value" | "stringList"
type ProtoField = {
  tag: number
  name: string
  kind: ProtoFieldKind
}
type ProtoCodec = {
  fields: readonly ProtoField[]
  toWire?: (value: any) => Record<string, unknown>
  fromWire?: (value: Record<string, unknown>) => unknown
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const PROTO_CODECS: Record<string, ProtoCodec> = {
  EmptyRequest: { fields: [] },
  HealthRequest: { fields: [] },
  HealthResponse: { fields: [{ tag: 1, name: "status", kind: "string" }] },
  CreateSessionRequest: { fields: [{ tag: 1, name: "session", kind: "struct" }] },
  SendRuntimeCommandRequest: {
    fields: [
      { tag: 1, name: "type", kind: "string" },
      { tag: 2, name: "mode", kind: "string" },
      { tag: 3, name: "sessionID", kind: "string" },
      { tag: 4, name: "body", kind: "struct" },
    ],
    toWire: (value) => value?.command ?? value ?? {},
    fromWire: (value) => ({ command: value }),
  },
  RuntimeCommandResponse: {
    fields: [
      { tag: 1, name: "accepted", kind: "bool" },
      { tag: 2, name: "status", kind: "uint32" },
      { tag: 3, name: "body", kind: "value" },
    ],
  },
  LoadSessionEvidenceRequest: {
    fields: [
      { tag: 1, name: "sessionID", kind: "string" },
      { tag: 2, name: "parameters", kind: "struct" },
    ],
  },
  SessionRequest: { fields: [{ tag: 1, name: "sessionID", kind: "string" }] },
  SessionQueryRequest: {
    fields: [
      { tag: 1, name: "sessionID", kind: "string" },
      { tag: 2, name: "parameters", kind: "struct" },
    ],
  },
  SessionJsonRequest: {
    fields: [
      { tag: 1, name: "sessionID", kind: "string" },
      { tag: 2, name: "body", kind: "struct" },
    ],
  },
  SessionMessageRequest: {
    fields: [
      { tag: 1, name: "sessionID", kind: "string" },
      { tag: 2, name: "messageID", kind: "string" },
    ],
  },
  BootstrapRequest: {
    fields: [
      { tag: 1, name: "include", kind: "struct" },
      { tag: 2, name: "sessionListStart", kind: "uint32" },
    ],
  },
  JsonRequest: { fields: [{ tag: 1, name: "body", kind: "struct" }] },
  JsonResponse: { fields: [{ tag: 1, name: "value", kind: "value" }] },
  RequestRequest: { fields: [{ tag: 1, name: "requestID", kind: "string" }] },
  RequestJsonRequest: {
    fields: [
      { tag: 1, name: "requestID", kind: "string" },
      { tag: 2, name: "body", kind: "struct" },
    ],
  },
  ProviderRequest: { fields: [{ tag: 1, name: "providerID", kind: "string" }] },
  ProviderJsonRequest: {
    fields: [
      { tag: 1, name: "providerID", kind: "string" },
      { tag: 2, name: "body", kind: "struct" },
    ],
  },
  ProviderAuthRequest: {
    fields: [
      { tag: 1, name: "providerID", kind: "string" },
      { tag: 2, name: "auth", kind: "struct" },
    ],
  },
  IdRequest: { fields: [{ tag: 1, name: "id", kind: "string" }] },
  IdJsonRequest: {
    fields: [
      { tag: 1, name: "id", kind: "string" },
      { tag: 2, name: "body", kind: "struct" },
    ],
  },
  NamedRequest: { fields: [{ tag: 1, name: "name", kind: "string" }] },
  McpAddRequest: {
    fields: [
      { tag: 1, name: "name", kind: "string" },
      { tag: 2, name: "config", kind: "struct" },
    ],
  },
  McpAuthCallbackRequest: {
    fields: [
      { tag: 1, name: "name", kind: "string" },
      { tag: 2, name: "code", kind: "string" },
    ],
  },
  QueryRequest: { fields: [{ tag: 1, name: "parameters", kind: "struct" }] },
  CommandRequest: {
    fields: [
      { tag: 1, name: "id", kind: "string" },
      { tag: 2, name: "command", kind: "string" },
    ],
  },
  ReorderRequest: {
    fields: [
      { tag: 1, name: "id", kind: "string" },
      { tag: 2, name: "position", kind: "int32" },
    ],
  },
  TemplateRequest: { fields: [{ tag: 1, name: "templateID", kind: "string" }] },
  RunRequest: { fields: [{ tag: 1, name: "runID", kind: "string" }] },
  RunQueryRequest: {
    fields: [
      { tag: 1, name: "runID", kind: "string" },
      { tag: 2, name: "parameters", kind: "struct" },
    ],
  },
  RunJsonRequest: {
    fields: [
      { tag: 1, name: "runID", kind: "string" },
      { tag: 2, name: "body", kind: "struct" },
    ],
  },
  WorkflowRunCommandRequest: {
    fields: [
      { tag: 1, name: "runID", kind: "string" },
      { tag: 2, name: "command", kind: "string" },
      { tag: 3, name: "body", kind: "struct" },
    ],
  },
  SubscribeEventsRequest: {
    fields: [
      { tag: 1, name: "types", kind: "stringList" },
      { tag: 2, name: "sessionID", kind: "string" },
    ],
  },
  RuntimeEvent: {
    fields: [
      { tag: 1, name: "type", kind: "string" },
      { tag: 2, name: "properties", kind: "value" },
      { tag: 3, name: "event", kind: "value" },
    ],
  },
  PtyClientEvent: {
    fields: [
      { tag: 1, name: "ptyID", kind: "string" },
      { tag: 2, name: "cursor", kind: "uint32" },
      { tag: 3, name: "type", kind: "string" },
      { tag: 4, name: "data", kind: "string" },
      { tag: 5, name: "cols", kind: "uint32" },
      { tag: 6, name: "rows", kind: "uint32" },
      { tag: 7, name: "code", kind: "uint32" },
      { tag: 8, name: "reason", kind: "string" },
    ],
  },
  PtyServerEvent: {
    fields: [
      { tag: 1, name: "type", kind: "string" },
      { tag: 2, name: "data", kind: "string" },
      { tag: 3, name: "cursor", kind: "uint32" },
      { tag: 4, name: "from", kind: "uint32" },
      { tag: 5, name: "gap", kind: "struct" },
      { tag: 6, name: "code", kind: "uint32" },
      { tag: 7, name: "reason", kind: "string" },
    ],
  },
}

export function bindAxCodeGrpcNodeHttp2Server(server: Http2.Http2Server, bridge: AxCodeGrpcNativeBridge) {
  server.on("stream", (stream, headers) => {
    void handleAxCodeGrpcHttp2Stream(stream, headers, bridge).catch((error) => {
      sendGrpcError(stream, 13, errorMessage(error))
    })
  })
}

export async function startAxCodeGrpcNodeHttp2Server(
  options: AxCodeGrpcNodeHttp2ServerOptions,
): Promise<AxCodeGrpcNodeHttp2ServerHandle> {
  const http2 = await import("node:http2")
  const host = options.host ?? "127.0.0.1"
  const server = http2.createServer()
  bindAxCodeGrpcNodeHttp2Server(server, options.bridge)
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(options.port ?? 0, host)
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("AX Code gRPC HTTP/2 server did not expose a TCP address")
  return {
    url: `http://${host}:${address.port}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export function encodeAxCodeGrpcProtoMessage(messageType: string, value: unknown): Uint8Array {
  const codec = getCodec(messageType)
  const wireValue = codec.toWire?.(value) ?? ((value ?? {}) as Record<string, unknown>)
  return encodeProtoObject(codec, wireValue)
}

export function decodeAxCodeGrpcProtoMessage(messageType: string, bytes: Uint8Array): unknown {
  const codec = getCodec(messageType)
  const wireValue = decodeProtoObject(codec, bytes)
  return codec.fromWire?.(wireValue) ?? wireValue
}

export function encodeAxCodeGrpcFrame(message: Uint8Array): Uint8Array {
  const frame = new Uint8Array(message.byteLength + 5)
  frame[0] = 0
  new DataView(frame.buffer, frame.byteOffset + 1, 4).setUint32(0, message.byteLength, false)
  frame.set(message, 5)
  return frame
}

export function decodeAxCodeGrpcFrames(bytes: Uint8Array): Uint8Array[] {
  const decoder = new GrpcFrameDecoder()
  const frames = decoder.push(bytes)
  decoder.finish()
  return frames
}

async function handleAxCodeGrpcHttp2Stream(
  stream: Http2.ServerHttp2Stream,
  headers: Http2.IncomingHttpHeaders,
  bridge: AxCodeGrpcNativeBridge,
) {
  if (headers[":method"] !== "POST") {
    sendGrpcError(stream, 3, "AX Code gRPC only accepts POST requests")
    return
  }
  const path = headerString(headers[":path"])
  if (!path) {
    sendGrpcError(stream, 3, "Missing gRPC method path")
    return
  }
  const descriptor = assertAxCodeGrpcMethodSupported(path as AxCodeGrpcMethod)
  const metadata = metadataFromHeaders(headers)
  switch (descriptor.kind) {
    case "unary": {
      assertAxCodeGrpcMethodSupported(descriptor.method, "unary")
      const request = await readUnaryGrpcMessage(stream, descriptor.requestType)
      const response = await bridge.unary({
        method: descriptor.method as AxCodeGrpcUnaryMethod,
        request,
        metadata,
      })
      sendGrpcHeaders(stream)
      stream.end(encodeAxCodeGrpcFrame(encodeAxCodeGrpcProtoMessage(descriptor.responseType, response)))
      break
    }
    case "serverStream": {
      assertAxCodeGrpcMethodSupported(descriptor.method, "serverStream")
      if (!bridge.serverStream) throw new Error("AX Code native bridge does not support server streaming")
      const request = await readUnaryGrpcMessage(stream, descriptor.requestType)
      const trailer = sendGrpcHeaders(stream)
      try {
        for await (const response of bridge.serverStream({
          method: descriptor.method as AxCodeGrpcStreamingMethod,
          request,
          metadata,
        })) {
          stream.write(encodeAxCodeGrpcFrame(encodeAxCodeGrpcProtoMessage(descriptor.responseType, response)))
        }
      } catch (error) {
        // Headers are already sent; report the failure via a non-OK trailer
        // instead of letting it reach sendGrpcError, which would double-respond
        // and the armed wantTrailers handler would still send grpc-status 0.
        trailer.status = 13
        trailer.message = errorMessage(error)
      }
      stream.end()
      break
    }
    case "bidiStream": {
      assertAxCodeGrpcMethodSupported(descriptor.method, "bidiStream")
      if (!bridge.bidiStream) throw new Error("AX Code native bridge does not support bidirectional streaming")
      const input = readGrpcMessages(stream, descriptor.requestType) as AsyncIterable<Record<string, unknown>>
      const prepared = await preparePtyBidiInput(input)
      const trailer = sendGrpcHeaders(stream)
      try {
        for await (const response of bridge.bidiStream({
          method: descriptor.method as AxCodeGrpcBidirectionalStreamingMethod,
          request: prepared.request,
          input: prepared.input,
          metadata,
        })) {
          stream.write(encodeAxCodeGrpcFrame(encodeAxCodeGrpcProtoMessage(descriptor.responseType, response)))
        }
      } catch (error) {
        // Headers are already sent; report the failure via a non-OK trailer
        // instead of letting it reach sendGrpcError (see serverStream above).
        trailer.status = 13
        trailer.message = errorMessage(error)
      }
      stream.end()
      break
    }
  }
}

async function readUnaryGrpcMessage(stream: Http2.ServerHttp2Stream, messageType: string) {
  let result: unknown = {}
  let count = 0
  for await (const message of readGrpcMessages(stream, messageType)) {
    result = message
    count++
  }
  if (count > 1) throw new Error(`Expected one ${messageType} gRPC message, received ${count}`)
  return result
}

async function* readGrpcMessages(stream: AsyncIterable<Uint8Array>, messageType: string): AsyncIterable<unknown> {
  const decoder = new GrpcFrameDecoder()
  for await (const chunk of stream) {
    for (const frame of decoder.push(chunk)) {
      yield decodeAxCodeGrpcProtoMessage(messageType, frame)
    }
  }
  decoder.finish()
}

async function preparePtyBidiInput(input: AsyncIterable<Record<string, unknown>>) {
  const iterator = input[Symbol.asyncIterator]()
  const first = await iterator.next()
  const firstValue = first.done ? undefined : first.value
  const request: AxCodeGrpcPtyConnectRequest = {
    id: typeof firstValue?.ptyID === "string" ? firstValue.ptyID : "",
    cursor: typeof firstValue?.cursor === "number" ? firstValue.cursor : undefined,
  }
  async function* events(): AsyncIterable<AxCodeGrpcPtyClientEvent> {
    if (firstValue && hasPtyClientEventPayload(firstValue)) yield normalizePtyClientEvent(firstValue)
    for (;;) {
      const next = await iterator.next()
      if (next.done) return
      yield normalizePtyClientEvent(next.value)
    }
  }
  return { request, input: events() }
}

function hasPtyClientEventPayload(value: Record<string, unknown>) {
  return (
    typeof value.type === "string" ||
    typeof value.data === "string" ||
    typeof value.cols === "number" ||
    typeof value.rows === "number" ||
    typeof value.code === "number" ||
    typeof value.reason === "string"
  )
}

function normalizePtyClientEvent(value: Record<string, unknown>): AxCodeGrpcPtyClientEvent {
  const type = typeof value.type === "string" ? value.type : undefined
  if ((!type || type === "input") && typeof value.data === "string") return { type: "input", data: value.data }
  if (type === "resize") {
    return {
      type,
      cols: typeof value.cols === "number" ? value.cols : 0,
      rows: typeof value.rows === "number" ? value.rows : 0,
    }
  }
  if (type === "close") {
    return {
      type,
      code: typeof value.code === "number" ? value.code : undefined,
      reason: typeof value.reason === "string" ? value.reason : undefined,
    }
  }
  return typeof value.data === "string" ? value.data : ""
}

type GrpcTrailerState = { status: number; message?: string }

// Sends the gRPC response headers and arms the trailer. The returned state
// defaults to grpc-status 0 (OK); a streaming handler that fails mid-stream
// can flip it to a non-OK status before calling stream.end() so the client
// sees the error in the trailer rather than a false success.
function sendGrpcHeaders(stream: Http2.ServerHttp2Stream): GrpcTrailerState {
  const trailer: GrpcTrailerState = { status: 0 }
  stream.respond(
    {
      ":status": 200,
      "content-type": "application/grpc+proto",
    },
    { waitForTrailers: true },
  )
  stream.once("wantTrailers", () => {
    if (stream.destroyed) return
    const trailers: Record<string, string> = { "grpc-status": String(trailer.status) }
    if (trailer.message !== undefined) trailers["grpc-message"] = encodeURIComponent(trailer.message)
    stream.sendTrailers(trailers)
  })
  return trailer
}

function sendGrpcError(stream: Http2.ServerHttp2Stream, code: number, message: string) {
  if (stream.destroyed) return
  stream.respond({
    ":status": 200,
    "content-type": "application/grpc+proto",
    "grpc-status": String(code),
    "grpc-message": encodeURIComponent(message),
  })
  stream.end()
}

function metadataFromHeaders(headers: Http2.IncomingHttpHeaders): AxCodeGrpcMetadata {
  const metadata: AxCodeGrpcMetadata = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":") || key === "content-type" || key === "te" || key.startsWith("grpc-")) continue
    const text = headerString(value)
    if (text !== undefined) metadata[key] = text
  }
  return metadata
}

function headerString(value: string | string[] | number | undefined) {
  if (Array.isArray(value)) return value.join(",")
  if (value === undefined) return undefined
  return String(value)
}

function encodeProtoObject(codec: ProtoCodec, value: Record<string, unknown>): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const field of codec.fields) {
    const fieldValue = value[field.name]
    if (field.kind === "stringList") {
      for (const item of Array.isArray(fieldValue) ? fieldValue : []) {
        chunks.push(encodeLengthDelimitedField(field.tag, textEncoder.encode(String(item))))
      }
      continue
    }
    if (fieldValue === undefined || fieldValue === null) continue
    switch (field.kind) {
      case "string":
        if (fieldValue === "") break
        chunks.push(encodeLengthDelimitedField(field.tag, textEncoder.encode(String(fieldValue))))
        break
      case "uint32":
      case "int32":
        if (Number(fieldValue) === 0) break
        chunks.push(encodeVarintField(field.tag, Number(fieldValue)))
        break
      case "bool":
        chunks.push(encodeVarintField(field.tag, fieldValue ? 1 : 0))
        break
      case "struct":
        chunks.push(encodeLengthDelimitedField(field.tag, encodeStruct(fieldValue)))
        break
      case "value":
        chunks.push(encodeLengthDelimitedField(field.tag, encodeValue(fieldValue)))
        break
    }
  }
  return concatBytes(chunks)
}

function decodeProtoObject(codec: ProtoCodec, bytes: Uint8Array): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const fields = new Map(codec.fields.map((field) => [field.tag, field]))
  let offset = 0
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset)
    offset = tag.offset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 7
    const field = fields.get(fieldNumber)
    const read = readWireValue(bytes, offset, wireType)
    offset = read.offset
    if (!field) continue
    const decoded = decodeFieldValue(field, read.value, wireType)
    if (field.kind === "stringList") {
      const values = (out[field.name] as string[] | undefined) ?? []
      values.push(String(decoded))
      out[field.name] = values
    } else {
      out[field.name] = decoded
    }
  }
  return out
}

function encodeFieldTag(fieldNumber: number, wireType: number) {
  return encodeVarint((fieldNumber << 3) | wireType)
}

function encodeVarintField(fieldNumber: number, value: number) {
  return concatBytes([encodeFieldTag(fieldNumber, 0), encodeVarint(value)])
}

function encodeFixed64Field(fieldNumber: number, value: number) {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, true)
  return concatBytes([encodeFieldTag(fieldNumber, 1), bytes])
}

function encodeLengthDelimitedField(fieldNumber: number, value: Uint8Array) {
  return concatBytes([encodeFieldTag(fieldNumber, 2), encodeVarint(value.byteLength), value])
}

function encodeValue(value: unknown): Uint8Array {
  if (value === null || value === undefined) return encodeVarintField(1, 0)
  if (typeof value === "number") return encodeFixed64Field(2, value)
  if (typeof value === "string") {
    // Return raw Value message bytes: field 3 (string_value) tag + length + content.
    // Do NOT wrap with an extra field tag — callers (encodeProtoObject,
    // encodeStruct, encodeListValue) add the outer field tag themselves.
    const strBytes = textEncoder.encode(value)
    return concatBytes([encodeFieldTag(3, 2), encodeVarint(strBytes.byteLength), strBytes])
  }
  if (typeof value === "boolean") return encodeVarintField(4, value ? 1 : 0)
  if (Array.isArray(value)) {
    const listBytes = encodeListValue(value)
    return concatBytes([encodeFieldTag(6, 2), encodeVarint(listBytes.byteLength), listBytes])
  }
  if (typeof value === "object") {
    const structBytes = encodeStruct(value)
    return concatBytes([encodeFieldTag(5, 2), encodeVarint(structBytes.byteLength), structBytes])
  }
  const fallback = textEncoder.encode(String(value))
  return concatBytes([encodeFieldTag(3, 2), encodeVarint(fallback.byteLength), fallback])
}

function decodeValue(bytes: Uint8Array): unknown {
  let offset = 0
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset)
    offset = tag.offset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 7
    const read = readWireValue(bytes, offset, wireType)
    offset = read.offset
    switch (fieldNumber) {
      case 1:
        return null
      case 2:
        return read.value
      case 3:
        return textDecoder.decode(read.value as Uint8Array)
      case 4:
        return Boolean(read.value)
      case 5:
        return decodeStruct(read.value as Uint8Array)
      case 6:
        return decodeListValue(read.value as Uint8Array)
    }
  }
  return undefined
}

function encodeStruct(value: unknown): Uint8Array {
  const object = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const chunks: Uint8Array[] = []
  for (const [key, entryValue] of Object.entries(object)) {
    const entry = concatBytes([
      encodeLengthDelimitedField(1, textEncoder.encode(key)),
      encodeLengthDelimitedField(2, encodeValue(entryValue)),
    ])
    chunks.push(encodeLengthDelimitedField(1, entry))
  }
  return concatBytes(chunks)
}

function decodeStruct(bytes: Uint8Array): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let offset = 0
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset)
    offset = tag.offset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 7
    const read = readWireValue(bytes, offset, wireType)
    offset = read.offset
    if (fieldNumber !== 1 || !(read.value instanceof Uint8Array)) continue
    const entry = decodeStructEntry(read.value)
    if (entry) out[entry.key] = entry.value
  }
  return out
}

function decodeStructEntry(bytes: Uint8Array): { key: string; value: unknown } | undefined {
  let key = ""
  let hasKey = false
  let value: unknown
  let offset = 0
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset)
    offset = tag.offset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 7
    const read = readWireValue(bytes, offset, wireType)
    offset = read.offset
    if (fieldNumber === 1 && read.value instanceof Uint8Array) {
      key = textDecoder.decode(read.value)
      hasKey = true
    }
    if (fieldNumber === 2 && read.value instanceof Uint8Array) value = decodeValue(read.value)
  }
  // Track key presence rather than truthiness so a legitimate empty-string key
  // ({ "": v }) is preserved instead of silently dropped.
  return hasKey ? { key, value } : undefined
}

function encodeListValue(value: unknown[]): Uint8Array {
  return concatBytes(value.map((item) => encodeLengthDelimitedField(1, encodeValue(item))))
}

function decodeListValue(bytes: Uint8Array): unknown[] {
  const out: unknown[] = []
  let offset = 0
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset)
    offset = tag.offset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 7
    const read = readWireValue(bytes, offset, wireType)
    offset = read.offset
    if (fieldNumber === 1 && read.value instanceof Uint8Array) out.push(decodeValue(read.value))
  }
  return out
}

function decodeFieldValue(field: ProtoField, value: Uint8Array | number | boolean, wireType: number): unknown {
  switch (field.kind) {
    case "string":
    case "stringList":
      return textDecoder.decode(value as Uint8Array)
    case "uint32":
    case "int32":
      return Number(value)
    case "bool":
      return Boolean(value)
    case "struct":
      return decodeStruct(value as Uint8Array)
    case "value":
      return decodeValue(value as Uint8Array)
  }
}

function readWireValue(bytes: Uint8Array, offset: number, wireType: number) {
  switch (wireType) {
    case 0:
      return readVarint(bytes, offset)
    case 1: {
      if (offset + 8 > bytes.byteLength) throw new Error("Truncated fixed64 protobuf field")
      return { value: new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true), offset: offset + 8 }
    }
    case 2: {
      const length = readVarint(bytes, offset)
      const start = length.offset
      const end = start + length.value
      if (end > bytes.byteLength) throw new Error("Truncated length-delimited protobuf field")
      return { value: bytes.slice(start, end), offset: end }
    }
    case 5: {
      if (offset + 4 > bytes.byteLength) throw new Error("Truncated fixed32 protobuf field")
      return { value: new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true), offset: offset + 4 }
    }
    default:
      throw new Error(`Unsupported protobuf wire type: ${wireType}`)
  }
}

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = []
  let current = value >>> 0
  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80)
    current >>>= 7
  }
  bytes.push(current)
  return new Uint8Array(bytes)
}

function readVarint(bytes: Uint8Array, offset: number) {
  let value = 0
  let shift = 0
  let cursor = offset
  while (cursor < bytes.byteLength) {
    const byte = bytes[cursor++]!
    // Use multiplication instead of bitwise shift to avoid 32-bit signed
    // integer overflow when shift >= 28 (values >= 2^28).
    value += (byte & 0x7f) * Math.pow(2, shift)
    if ((byte & 0x80) === 0) return { value: value >>> 0, offset: cursor }
    shift += 7
    if (shift > 35) throw new Error("Protobuf varint too large")
  }
  throw new Error("Truncated protobuf varint")
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

function getCodec(messageType: string) {
  const codec = PROTO_CODECS[messageType]
  if (!codec) throw new Error(`Unsupported AX Code gRPC proto message type: ${messageType}`)
  return codec
}

class GrpcFrameDecoder {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0)

  push(chunk: Uint8Array) {
    this.buffer = concatBytes([this.buffer, chunk])
    const frames: Uint8Array[] = []
    let offset = 0
    while (this.buffer.byteLength - offset >= 5) {
      const compressed = this.buffer[offset]
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset + 1, 4).getUint32(0, false)
      if (this.buffer.byteLength - offset - 5 < length) break
      if (compressed !== 0) throw new Error("AX Code gRPC does not support compressed messages")
      frames.push(this.buffer.slice(offset + 5, offset + 5 + length))
      offset += 5 + length
    }
    this.buffer = this.buffer.slice(offset)
    return frames
  }

  finish() {
    if (this.buffer.byteLength !== 0) throw new Error("Truncated gRPC message frame")
  }
}
