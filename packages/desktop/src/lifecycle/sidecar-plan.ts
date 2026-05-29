import type { HeadlessBackendOptions } from "@ax-code/sdk/headless"

export type DesktopBackendMode = "start" | "attach"

export type DesktopBackendPlan =
  | {
      mode: "start"
      options: HeadlessBackendOptions
      loopbackOnly: true
      generatedAuth: true
    }
  | {
      mode: "attach"
      baseUrl: string
      headers: Record<string, string>
      loopbackOnly: boolean
      generatedAuth: false
    }

export function createStartBackendPlan(
  options: Pick<HeadlessBackendOptions, "directory" | "port" | "env">,
): DesktopBackendPlan {
  return {
    mode: "start",
    options: {
      directory: options.directory,
      port: options.port ?? 0,
      hostname: "127.0.0.1",
      env: options.env,
    },
    loopbackOnly: true,
    generatedAuth: true,
  }
}

export function createAttachBackendPlan(input: { baseUrl: string; authHeader?: string }): DesktopBackendPlan {
  const url = new URL(input.baseUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Attached desktop backend URL must use HTTP or HTTPS.")
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error("Attached desktop backend URL must use a loopback host.")
  }
  return {
    mode: "attach",
    baseUrl: url.toString().replace(/\/$/, ""),
    headers: input.authHeader ? { authorization: input.authHeader } : {},
    loopbackOnly: true,
    generatedAuth: false,
  }
}

export function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]"
}
