import { afterEach, describe, expect, test } from "vitest"
import { ComputerActionTool } from "../../src/tool/computer/action"
import { ComputerSnapshotTool } from "../../src/tool/computer/snapshot"
import { createFakeComputerHost } from "../../src/visual/computer/fake-host"
import { setComputerHost } from "../../src/visual/computer/protocol"
import type { Tool } from "../../src/tool/tool"
import { MessageID, SessionID } from "../../src/session/schema"

function ctx(): Tool.Context {
  return {
    sessionID: SessionID.make("ses_computer_test"),
    messageID: MessageID.make("msg_computer_test"),
    agent: "work",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    ask: async () => {},
  }
}

afterEach(() => {
  setComputerHost(undefined)
})

describe("computer tools", () => {
  test("snapshot fails closed without a host", async () => {
    const tool = await ComputerSnapshotTool.init()
    await expect(tool.execute({ target: { type: "frontmost" } }, ctx())).rejects.toThrow("COMPUTER_HOST_UNAVAILABLE")
  })

  test("fake host snapshot then action consumes the frame", async () => {
    setComputerHost(createFakeComputerHost())
    const snapshot = await (await ComputerSnapshotTool.init()).execute({ target: { type: "app", query: "TextEdit" } }, ctx())
    const frameID = snapshot.metadata.frameID as string
    expect(frameID).toBeTruthy()
    expect(snapshot.output).toContain('trust="untrusted"')

    const action = await (await ComputerActionTool.init()).execute(
      { frameID, action: "click", elementID: "e1" },
      ctx(),
    )
    expect(action.metadata.consumedFrameID).toBe(frameID)
    expect(action.metadata.frameID).not.toBe(frameID)

    await expect(
      (await ComputerActionTool.init()).execute({ frameID, action: "click", elementID: "e1" }, ctx()),
    ).rejects.toThrow("COMPUTER_STALE_FRAME")
    expect(action.attachments).toBeUndefined()
    expect(snapshot.attachments).toBeUndefined()
  })
})
