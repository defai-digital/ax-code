import { describe, expect, test } from "vitest"
import { appErrorEnvelope } from "../../src/server/error"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { WorkflowUnsupportedMergeStrategyError } from "../../src/workflow/scheduler"
import { SessionID, MessageID } from "../../src/session/schema"
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

  test("maps SessionRevert.IncompleteCoverageError to a 400 with its remediation message", () => {
    // The revert route declares errors(400, 404); an unfinished tool step is a
    // client-visible state the caller can act on, so it must not surface as a
    // generic 500 that drops the remediation text.
    const envelope = appErrorEnvelope({
      error: new SessionRevert.IncompleteCoverageError({
        message:
          "Undo coverage is incomplete for an unfinished tool step. Inspect and restore workspace changes manually.",
        sessionID: SessionID.make("ses_revert_incomplete"),
        messageID: MessageID.make("msg_revert_incomplete"),
      }),
    })
    expect(envelope).toMatchObject({
      name: "InvalidRequestError",
      status: 400,
      message: expect.stringContaining("Undo coverage is incomplete"),
      details: { resource: "sessionRevert" },
    })
  })

  test("maps an unsupported workflow merge strategy to a 400 with its message", () => {
    // `custom-reducer` is a legal spec enum value the runtime cannot execute;
    // the client-caused failure must not surface as a generic 500.
    const error = new WorkflowUnsupportedMergeStrategyError("phase_collect", "custom-reducer")
    const envelope = appErrorEnvelope({ error })
    expect(envelope).toMatchObject({
      name: "InvalidRequestError",
      status: 400,
      message: error.message,
      details: { resource: "workflow" },
    })
  })

  test("an unrelated plain Error still falls through to UnknownError/500", () => {
    const envelope = appErrorEnvelope({ error: new Error("boom") })
    expect(envelope).toMatchObject({ name: "UnknownError", status: 500 })
  })
})
