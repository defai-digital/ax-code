import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Context } from "../util/context"
import type { SessionID } from "./schema"

// Context belongs to the caller, never to the session's latest global run.
export namespace SessionExecutionContext {
  export const Stamp = z.object({ version: z.literal(1), generation: z.uuid() }).strict()
  export type Stamp = z.infer<typeof Stamp>
  export type Turn = { sessionID: SessionID; stamp: Stamp; active: boolean }
  const context = Context.create<Turn | undefined>("session.execution")

  export const StaleWriteError = NamedError.create(
    "SessionExecutionStaleWriteError",
    z.object({ message: z.string(), sessionID: z.string() }),
  )

  export const peek = context.peek
  export const provide = context.provide

  // Only trusted control-plane launchers use this. A retired tool callback
  // keeps its originating token and remains forbidden from writing.
  export function detached<T>(body: () => T): T {
    return context.provide(undefined, body)
  }

  export function assertWritable() {
    const turn = context.peek()
    if (turn && !turn.active) {
      throw new StaleWriteError({ message: "The originating session turn has ended", sessionID: turn.sessionID })
    }
  }

  export function stamp(sessionID: SessionID): Stamp | undefined {
    assertWritable()
    const turn = context.peek()
    return turn?.sessionID === sessionID ? turn.stamp : undefined
  }
}
