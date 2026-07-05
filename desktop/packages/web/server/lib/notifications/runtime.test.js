import { afterEach, describe, expect, it, vi } from "vitest"

import { createNotificationTriggerRuntime } from "./runtime.js"

const createRuntime = (overrides = {}) => {
  const emitted = []
  const broadcast = []
  const runtime = createNotificationTriggerRuntime({
    readSettingsFromDisk: vi.fn(async () => ({
      nativeNotificationsEnabled: true,
      notificationMode: "always",
    })),
    prepareNotificationLastMessage: vi.fn(async ({ message }) => message || ""),
    buildTemplateVariables: vi.fn(async () => {
      throw new Error("skip custom template resolution")
    }),
    extractLastMessageText: vi.fn(() => ""),
    fetchLastAssistantMessageText: vi.fn(async () => ""),
    resolveNotificationTemplate: vi.fn((template) => template || ""),
    shouldApplyResolvedTemplateMessage: vi.fn(() => false),
    emitDesktopNotification: vi.fn((payload) => emitted.push(payload)),
    broadcastUiNotification: vi.fn((payload) => broadcast.push(payload)),
    buildAxCodeUrl: vi.fn((path) => path),
    getAxCodeAuthHeaders: vi.fn(() => ({})),
    ...overrides,
  })
  return { runtime, emitted, broadcast }
}

describe("notification trigger runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("formats default completion notification mode and model labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        body: { cancel: vi.fn() },
      })),
    )
    const { runtime, emitted, broadcast } = createRuntime()

    await runtime.maybeDispatchNotificationForTrigger({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_test",
          sessionID: "ses_test",
          role: "assistant",
          finish: "stop",
          mode: "debug-agent",
          modelID: "glm-5-1-air",
        },
      },
    })

    expect(emitted).toEqual([
      expect.objectContaining({
        title: "Debug Agent agent is ready",
        body: "Glm 5.1 Air completed the task",
        kind: "ready",
        sessionId: "ses_test",
      }),
    ])
    expect(broadcast).toEqual(emitted)
  })
})
