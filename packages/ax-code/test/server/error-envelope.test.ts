import { describe, expect, test } from "vitest"
import { appErrorEnvelope } from "../../src/server/error"
import { Session } from "../../src/session"
import { File } from "../../src/file"

describe("server appErrorEnvelope classification", () => {
  test("maps a real Session.BusyError through the plain-Error path to SessionBusyError/409", () => {
    // Regression guard for the minification hazard: classification must not
    // depend on error.constructor.name, which bundlers mangle.
    const envelope = appErrorEnvelope({ error: new Session.BusyError("ses_busy") })
    expect(envelope).toMatchObject({
      name: "SessionBusyError",
      status: 409,
      retryable: true,
    })
  })

  test("maps File.AccessDeniedError to ForbiddenError/403 with its message", () => {
    const envelope = appErrorEnvelope({
      error: new File.AccessDeniedError({ message: "Access denied: symlink target escapes project directory" }),
    })
    expect(envelope).toMatchObject({
      name: "ForbiddenError",
      status: 403,
      message: "Access denied: symlink target escapes project directory",
    })
  })

  test("an unrelated plain Error still falls through to UnknownError/500", () => {
    const envelope = appErrorEnvelope({ error: new Error("boom") })
    expect(envelope).toMatchObject({ name: "UnknownError", status: 500 })
  })
})
