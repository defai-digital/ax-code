import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { UPDATE_PROGRESS_EVENT, sendUpdateProgressToWindows } = require("./update-progress.js")

const mockWindow = ({ destroyed = false } = {}) => {
  const sends = []
  return {
    sends,
    isDestroyed: () => destroyed,
    webContents: {
      send: (event, payload) => sends.push({ event, payload }),
    },
  }
}

describe("sendUpdateProgressToWindows", () => {
  test("broadcasts updater progress to every live window", () => {
    const first = mockWindow()
    const second = mockWindow()
    const destroyed = mockWindow({ destroyed: true })

    expect(
      sendUpdateProgressToWindows([first, destroyed, second], "Progress", { downloaded: 5, total: 10 }),
    ).toBe(2)

    expect(first.sends).toEqual([
      {
        event: UPDATE_PROGRESS_EVENT,
        payload: { event: "Progress", data: { downloaded: 5, total: 10 } },
      },
    ])
    expect(second.sends).toEqual(first.sends)
    expect(destroyed.sends).toEqual([])
  })

  test("skips malformed window entries without throwing", () => {
    const live = mockWindow()

    expect(sendUpdateProgressToWindows([null, {}, { isDestroyed: () => false }, live], "Finished", {})).toBe(1)
    expect(live.sends).toEqual([
      {
        event: UPDATE_PROGRESS_EVENT,
        payload: { event: "Finished", data: {} },
      },
    ])
  })
})
