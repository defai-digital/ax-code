import { newComputerFrameID } from "./frame"
import {
  ComputerError,
  type ComputerActionRequest,
  type ComputerFrame,
  type ComputerHost,
  type ComputerSnapshotTarget,
} from "./protocol"

/**
 * In-process host for unit tests. Tracks one live frame and rejects stale IDs.
 */
export function createFakeComputerHost(seed?: Partial<ComputerFrame>): ComputerHost {
  let live = seedFrame(seed)
  const consumed = new Set<string>()

  return {
    async snapshot(input: { target: ComputerSnapshotTarget }) {
      live = seedFrame({
        ...live,
        app: {
          ...live.app,
          displayName: input.target.type === "app" ? input.target.query : live.app.displayName,
        },
      })
      return live
    },
    async act(input: { request: ComputerActionRequest }) {
      const { frameID } = input.request
      if (consumed.has(frameID) || frameID !== live.frameID) {
        throw new ComputerError("COMPUTER_STALE_FRAME", `Frame ${frameID} is no longer current`)
      }
      consumed.add(frameID)
      live = seedFrame({
        app: live.app,
        window: live.window,
      })
      return live
    },
  }
}

function seedFrame(partial?: Partial<ComputerFrame>): ComputerFrame {
  return {
    frameID: newComputerFrameID(),
    app: partial?.app ?? { appID: "com.apple.TextEdit", displayName: "TextEdit", pid: 1 },
    window: partial?.window ?? {
      windowID: "w1",
      title: "Untitled",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      scaleFactor: 2,
    },
    image: partial?.image ?? { width: 800, height: 600, mime: "image/png" },
    elements: partial?.elements ?? [
      {
        elementID: "e1",
        role: "AXTextArea",
        name: "text",
        bounds: { x: 10, y: 10, width: 780, height: 580 },
      },
    ],
    capturedAt: partial?.capturedAt ?? Date.now(),
  }
}
