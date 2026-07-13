import { directoryRequestHeaders } from "@tui/util/request-headers"

export function sessionRiskURL(input: { baseUrl: string; sessionID: string }) {
  const url = new URL(`${input.baseUrl}/session/${encodeURIComponent(input.sessionID)}/risk`)
  url.searchParams.set("quality", "true")
  url.searchParams.set("findings", "true")
  url.searchParams.set("envelopes", "true")
  url.searchParams.set("reviewResults", "true")
  url.searchParams.set("debug", "true")
  url.searchParams.set("hints", "true")
  return url.toString()
}

export function sessionGoalURL(input: { baseUrl: string; sessionID: string }) {
  return new URL(`${input.baseUrl}/session/${encodeURIComponent(input.sessionID)}/goal`).toString()
}

export function sessionDerivedRequestHeaders(directory?: string) {
  return directoryRequestHeaders({
    directory,
    accept: "application/json",
  })
}
