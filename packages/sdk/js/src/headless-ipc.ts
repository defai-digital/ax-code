/**
 * IPC transport for headless AX Code backends: length-prefixed message
 * framing for the headless IPC protocol (`encodeIpcMessage`,
 * `decodeIpcFrames`, `readIpcMessages`, `writeIpcMessage`) and the
 * `createIpcTransport` adapter satisfying the headless transport contract.
 *
 * @module
 */

export { createIpcTransport, type IpcTransportOptions, IpcTransportError } from "./headless/ipc-transport.js"
export {
  encodeIpcMessage,
  decodeIpcFrames,
  readIpcMessages,
  writeIpcMessage,
  IpcFrameTooLargeError,
  IPC_MAX_FRAME_BYTES,
  type IpcMessage,
  type IpcRequestMessage,
  type IpcResponseMessage,
  type IpcErrorMessage,
  type IpcEventMessage,
  type IpcFrame,
} from "./headless/ipc-protocol.js"
