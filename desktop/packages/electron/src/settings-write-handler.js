"use strict"

// S2.3 (SPEC-2026-08-29-desktop-process-model-collapse §2 D5): Electron main is
// the sole writer of settings.json. The web-server utilityProcess no longer
// writes the file directly; every web-side settings mutation arrives here as a
// "settings-write" message over the utilityProcess channel and is applied by
// main through the serialized read-modify-write chain (mutateSettingsRoot) and
// its atomic tmp+rename writer.
//
// Protocol (same channel as the existing "ready"/"stop" messages):
//   request : { type: "settings-write", id: string, settings: object }
//   response: { type: "settings-write-result", id: string, ok: true }
//           | { type: "settings-write-result", id: string, ok: false, error: string }
//
// The web side always sends the complete next settings object (its
// persistSettings merges changes against the on-disk state before sending), so
// the only supported mutation is a full-object replace — no partial-merge or
// key-path shapes exist on the sender side. Settings payloads may contain
// secrets (UI password hashes, project metadata), so payload values are never
// logged here.
const DEFAULT_MAX_SETTINGS_PAYLOAD_BYTES = 1024 * 1024

const createSettingsWriteHandler = ({ mutateSettingsRoot, postMessage, maxPayloadBytes, logger }) => {
  const log = logger || console
  const limit =
    Number.isInteger(maxPayloadBytes) && maxPayloadBytes > 0 ? maxPayloadBytes : DEFAULT_MAX_SETTINGS_PAYLOAD_BYTES

  // Returns true when the message was a settings-write request (handled),
  // false so the caller can continue dispatching other message types.
  const handleMessage = (msg) => {
    if (!msg || msg.type !== "settings-write") return false

    const id = typeof msg.id === "string" ? msg.id : ""
    const reply = (ok, error) => {
      try {
        postMessage(
          ok
            ? { type: "settings-write-result", id, ok: true }
            : { type: "settings-write-result", id, ok: false, error: String(error || "settings write failed") },
        )
      } catch (replyError) {
        log.error("[electron] failed to reply to settings-write request:", replyError)
      }
    }

    const settings = msg.settings
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      reply(false, "settings-write payload must be a plain object")
      return true
    }
    let payloadBytes
    try {
      payloadBytes = Buffer.byteLength(JSON.stringify(settings), "utf8")
    } catch {
      reply(false, "settings-write payload is not JSON-serializable")
      return true
    }
    if (payloadBytes > limit) {
      reply(false, `settings-write payload exceeds ${limit} bytes`)
      return true
    }

    // Full-object replace. mutateSettingsRoot serializes this against main's
    // own mutations (window state, vibrancy, remote-access purge), so two
    // concurrent delegated writes cannot interleave with them or each other.
    void Promise.resolve()
      .then(() => mutateSettingsRoot(() => settings))
      .then(() => reply(true))
      .catch((error) => {
        reply(false, error instanceof Error ? error.message : String(error))
      })
    return true
  }

  return { handleMessage }
}

module.exports = { createSettingsWriteHandler, DEFAULT_MAX_SETTINGS_PAYLOAD_BYTES }
