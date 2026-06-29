import { describe, expect, test, vi } from "vitest"

import type { PasskeyStatus, StoredPasskey } from "@/lib/passkeys"
import { loadCurrentPasskeySettings } from "./passkeySettingsLoad"

const enabledStatus: PasskeyStatus = {
  enabled: true,
  hasPasskeys: true,
  passkeyCount: 1,
  rpID: "localhost",
}

const disabledStatus: PasskeyStatus = {
  enabled: false,
  hasPasskeys: false,
  passkeyCount: 0,
  rpID: null,
}

const passkey: StoredPasskey = {
  id: "key-1",
  label: "Chrome",
  createdAt: 1,
  lastUsedAt: null,
  deviceType: "singleDevice",
  backedUp: false,
}

describe("loadCurrentPasskeySettings", () => {
  test("loads enabled passkey settings for the current request", async () => {
    await expect(
      loadCurrentPasskeySettings({
        supportState: { supported: true, reason: "" },
        fetchStatus: vi.fn(async () => enabledStatus),
        fetchPasskeys: vi.fn(async () => [passkey]),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", passkeyStatus: enabledStatus, passkeys: [passkey] })
  })

  test("returns disabled without fetching passkeys when passkey auth is off", async () => {
    const fetchPasskeys = vi.fn(async () => [passkey])

    await expect(
      loadCurrentPasskeySettings({
        supportState: { supported: true, reason: "" },
        fetchStatus: vi.fn(async () => disabledStatus),
        fetchPasskeys,
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "disabled", passkeyStatus: disabledStatus })
    expect(fetchPasskeys).not.toHaveBeenCalled()
  })

  test("suppresses status responses from stale requests", async () => {
    await expect(
      loadCurrentPasskeySettings({
        supportState: { supported: true, reason: "" },
        fetchStatus: vi.fn(async () => enabledStatus),
        fetchPasskeys: vi.fn(async () => [passkey]),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses passkey-list errors from stale requests", async () => {
    let current = true

    await expect(
      loadCurrentPasskeySettings({
        supportState: { supported: true, reason: "" },
        fetchStatus: vi.fn(async () => enabledStatus),
        fetchPasskeys: vi.fn(async () => {
          current = false
          throw new Error("request closed")
        }),
        isCurrent: () => current,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
