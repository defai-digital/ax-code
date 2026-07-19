import { afterEach, describe, expect, test, vi } from "vitest"
import { xaiAuthPlugin } from "../../../src/provider/xai/auth-plugin"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("xAI device authorization", () => {
  test("cancels polling when the caller aborts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_code: "device-code",
          user_code: "user-code",
          verification_uri: "https://example.com/device",
          expires_in: 300,
          interval: 5,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const hooks = await xaiAuthPlugin({} as never)
    const method = hooks.auth?.methods[0]
    if (!method || method.type !== "oauth") throw new Error("missing xAI OAuth method")
    const flow = await method.authorize()
    if (flow.method !== "auto") throw new Error("xAI OAuth method must use automatic polling")
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))

    await expect(flow.callback(controller.signal)).rejects.toThrow("cancelled")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("stores access token as API key when refresh_token is missing", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-code",
            user_code: "user-code",
            verification_uri: "https://example.com/device",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-only" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

    const hooks = await xaiAuthPlugin({} as never)
    const method = hooks.auth?.methods[0]
    if (!method || method.type !== "oauth") throw new Error("missing xAI OAuth method")
    const flow = await method.authorize()
    if (flow.method !== "auto") throw new Error("xAI OAuth method must use automatic polling")

    await expect(flow.callback()).resolves.toEqual({
      type: "success",
      key: "access-only",
    })
  })

  test("returns oauth credentials when refresh_token is present", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-code",
            user_code: "user-code",
            verification_uri: "https://example.com/device",
            expires_in: 300,
            interval: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

    const hooks = await xaiAuthPlugin({} as never)
    const method = hooks.auth?.methods[0]
    if (!method || method.type !== "oauth") throw new Error("missing xAI OAuth method")
    const flow = await method.authorize()
    if (flow.method !== "auto") throw new Error("xAI OAuth method must use automatic polling")

    const result = await flow.callback()
    expect(result).toMatchObject({
      type: "success",
      access: "access-token",
      refresh: "refresh-token",
    })
    expect(result).not.toHaveProperty("key")
  })
})
