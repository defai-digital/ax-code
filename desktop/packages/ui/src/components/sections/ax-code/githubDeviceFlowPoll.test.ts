import { describe, expect, test, vi } from "vitest"

import { pollCurrentGitHubDeviceFlow, type DeviceFlowCompleteResponse } from "./githubDeviceFlowPoll"

const connectedResult: Extract<DeviceFlowCompleteResponse, { connected: true }> = {
  connected: true,
  user: { login: "alice" },
  scope: "repo",
}

const slowDownResult: DeviceFlowCompleteResponse = { connected: false, status: "slow_down" }
const expiredResult: DeviceFlowCompleteResponse = { connected: false, status: "expired_token", error: "Expired" }

describe("pollCurrentGitHubDeviceFlow", () => {
  test("returns connected results for the current poll", async () => {
    await expect(
      pollCurrentGitHubDeviceFlow({
        deviceCode: "device-1",
        pollOnce: vi.fn(async () => connectedResult),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "connected", result: connectedResult })
  })

  test("maps slow_down responses", async () => {
    await expect(
      pollCurrentGitHubDeviceFlow({
        deviceCode: "device-1",
        pollOnce: vi.fn(async () => slowDownResult),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "slow-down" })
  })

  test("maps terminal authorization failures", async () => {
    await expect(
      pollCurrentGitHubDeviceFlow({
        deviceCode: "device-1",
        pollOnce: vi.fn(async () => expiredResult),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "authorization-failed", error: "Expired" })
  })

  test("suppresses stale poll results", async () => {
    await expect(
      pollCurrentGitHubDeviceFlow({
        deviceCode: "device-1",
        pollOnce: vi.fn(async () => connectedResult),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale polls", async () => {
    await expect(
      pollCurrentGitHubDeviceFlow({
        deviceCode: "device-1",
        pollOnce: vi.fn(async () => {
          throw new Error("network closed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
