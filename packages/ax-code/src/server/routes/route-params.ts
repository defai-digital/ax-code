import { SessionID } from "@/session/schema"
import { ProviderID } from "@/provider/schema"
import { ProjectID } from "@/project/schema"
import { PtyID } from "@/pty/schema"
import { QuestionID } from "@/question/schema"
import { PermissionID } from "@/permission/schema"
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
export const PROJECT_ID_PARAM = z.object({
  projectID: ProjectID.zod,
})
export const PTY_ID_PARAM = z.object({
  ptyID: PtyID.zod,
})
export const QUESTION_REQUEST_ID_PARAM = z.object({
  requestID: QuestionID.zod,
})
export const PERMISSION_REQUEST_ID_PARAM = z.object({
  requestID: PermissionID.zod,
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

export function withProjectID<T>(handler: (projectID: ProjectID, c: any) => T) {
  return withRouteParam<"projectID", ProjectID>("projectID", handler)
}

export function withPtyID<T>(handler: (ptyID: PtyID, c: any) => T) {
  return withRouteParam<"ptyID", PtyID>("ptyID", handler)
}

export function withQuestionRequestID<T>(handler: (requestID: QuestionID, c: any) => T) {
  return withRouteParam<"requestID", QuestionID>("requestID", handler)
}

export function withPermissionRequestID<T>(handler: (requestID: PermissionID, c: any) => T) {
  return withRouteParam<"requestID", PermissionID>("requestID", handler)
}
