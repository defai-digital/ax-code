import { SessionID } from "@/session/schema"
import { ProviderID } from "@/provider/schema"
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
export const PROVIDER_ID_PARAM = z.object({
  providerID: ProviderID.zod.meta({ description: "Provider ID" }),
})

export async function parseExistingSessionID(c: SessionRouteContext) {
  const sessionID = parseSessionID(c)
  await assertSessionExists(sessionID)
  return sessionID
}

export function withRouteParam<TKey extends string, TValue>(
  key: TKey,
  handler: (value: TValue, c: any) => any,
) {
  return (c: any) => {
    const params = c.req.valid("param") as { [key in TKey]: TValue }
    const value = params[key]
    return handler(value, c)
  }
}

export function withProviderID<T>(handler: (providerID: ProviderID, c: any) => T) {
  return withRouteParam<"providerID", ProviderID>("providerID", handler)
}
