import type { PasskeyStatus, StoredPasskey } from "@/lib/passkeys"

export type PasskeySupportState = {
  supported: boolean
  reason: string
}

export type PasskeySettingsLoadResult =
  | { status: "unsupported" }
  | { status: "disabled"; passkeyStatus: PasskeyStatus }
  | { status: "loaded"; passkeyStatus: PasskeyStatus; passkeys: StoredPasskey[] }
  | { status: "stale" }
  | { status: "failed"; error: unknown }

export const loadCurrentPasskeySettings = async ({
  supportState,
  fetchStatus,
  fetchPasskeys,
  isCurrent,
}: {
  supportState: PasskeySupportState
  fetchStatus: () => Promise<PasskeyStatus>
  fetchPasskeys: () => Promise<StoredPasskey[]>
  isCurrent: () => boolean
}): Promise<PasskeySettingsLoadResult> => {
  if (!supportState.supported) {
    return isCurrent() ? { status: "unsupported" } : { status: "stale" }
  }

  try {
    const passkeyStatus = await fetchStatus()
    if (!isCurrent()) {
      return { status: "stale" }
    }

    if (!passkeyStatus.enabled) {
      return { status: "disabled", passkeyStatus }
    }

    const passkeys = await fetchPasskeys()
    if (!isCurrent()) {
      return { status: "stale" }
    }

    return { status: "loaded", passkeyStatus, passkeys }
  } catch (error) {
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "failed", error }
  }
}
