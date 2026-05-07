import { ProviderID } from "@/provider/schema"
import { SessionID } from "@/session/schema"

export type ProviderRouteContext = {
  req: {
    valid: (input: "param") => { providerID: string }
  }
}

export function parseProviderID(c: ProviderRouteContext) {
  return ProviderID.make(c.req.valid("param").providerID)
}

export type SessionRouteContext = {
  req: {
    valid: (input: "param") => { sessionID: string }
  }
}

export function parseSessionID(c: SessionRouteContext) {
  return SessionID.make(c.req.valid("param").sessionID)
}

export type RouteParamContext<TKey extends string, TValue> = {
  req: {
    valid: (input: "param") => { [key in TKey]: TValue }
  }
}

export function parseRouteParam<TKey extends string, TValue>(c: RouteParamContext<TKey, TValue>, key: TKey): TValue {
  return c.req.valid("param")[key]
}
