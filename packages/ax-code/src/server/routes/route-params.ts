import { SessionID } from "@/session/schema"
import z from "zod"

import { assertSessionExists } from "./session-lookup"

export type SessionRouteContext = {
  req: {
    valid: (input: "param") => { sessionID: string }
  }
}

export function parseSessionID(c: SessionRouteContext) {
  return SessionID.make(c.req.valid("param").sessionID)
}

export const SESSION_ID_PARAM = z.object({ sessionID: SessionID.zod })

export async function parseExistingSessionID(c: SessionRouteContext) {
  const sessionID = parseSessionID(c)
  await assertSessionExists(sessionID)
  return sessionID
}

export type RouteParamContext<TKey extends string, TValue> = {
  req: {
    valid: (input: "param") => { [key in TKey]: TValue }
  }
}

export function parseRouteParam<TKey extends string, TValue>(c: RouteParamContext<TKey, TValue>, key: TKey): TValue {
  return c.req.valid("param")[key]
}

export function withRouteParam<TKey extends string, TValue>(
  key: TKey,
  handler: (value: TValue, c: any) => any,
) {
  return (c: any) => {
    const value = parseRouteParam<TKey, TValue>(c, key)
    return handler(value, c)
  }
}
