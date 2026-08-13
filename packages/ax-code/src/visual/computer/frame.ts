import crypto from "crypto"
import {
  COMPUTER_IMAGE_MAX_BYTES,
  COMPUTER_IMAGE_MAX_LONG_EDGE,
  type ComputerFrame,
} from "./protocol"

export function newComputerFrameID() {
  return crypto.randomUUID()
}

export function assertImagePixelCoordinate(frame: ComputerFrame, x: number, y: number) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new Error("Computer coordinates must be non-negative integers in returned-image pixels")
  }
  if (x >= frame.image.width || y >= frame.image.height) {
    throw new Error(
      `Computer coordinate (${x},${y}) is outside the returned image ${frame.image.width}x${frame.image.height}`,
    )
  }
}

export function imageBudgetOk(input: { width: number; height: number; bytes: number }) {
  const longEdge = Math.max(input.width, input.height)
  return longEdge <= COMPUTER_IMAGE_MAX_LONG_EDGE && input.bytes <= COMPUTER_IMAGE_MAX_BYTES
}

export function wrapUntrustedObservation(summary: string) {
  return `<computer_observation trust="untrusted">\n${summary}\n</computer_observation>`
}
