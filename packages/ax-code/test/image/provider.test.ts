import { afterEach, describe, expect, test, vi } from "vitest"
import { CustomImageProvider, OpenAIImageProvider, StabilityImageProvider } from "../../src/image/provider"

const imageBytes = Buffer.from("generated-image")
const imageBase64 = imageBytes.toString("base64")

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("OpenAIImageProvider", () => {
  test("defaults to gpt-image-2 without the unsupported response_format field", async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [{ b64_json: imageBase64 }],
          output_format: "png",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const signal = new AbortController().signal
    const provider = new OpenAIImageProvider({ options: { apiKey: "test-key" } })
    const result = await provider.generate({
      prompt: "draw an otter",
      size: "1024x1024",
      name: "otter",
      signal,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      model: "gpt-image-2",
      prompt: "draw an otter",
      n: 1,
      size: "1024x1024",
      output_format: "png",
    })
    expect(body).not.toHaveProperty("response_format")
    expect(init?.signal).toBe(signal)
    expect(result).toEqual({ data: imageBytes, mimeType: "image/png" })
  })

  test("keeps response_format for explicitly configured DALL-E models", async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      return new Response(JSON.stringify({ data: [{ b64_json: imageBase64 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const provider = new OpenAIImageProvider({
      options: {
        apiKey: "test-key",
        model: "dall-e-3",
      },
    })
    await provider.generate({
      prompt: "draw an otter",
      size: "1792x1024",
      name: "otter",
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body.response_format).toBe("b64_json")
    expect(body).not.toHaveProperty("output_format")
  })
})

describe("other image providers", () => {
  test("passes cancellation through Stability requests", async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      return new Response(imageBytes, { status: 200, headers: { "content-type": "image/png" } })
    })
    vi.stubGlobal("fetch", fetchMock)

    const signal = new AbortController().signal
    const provider = new StabilityImageProvider({ options: { apiKey: "test-key" } })
    await provider.generate({
      prompt: "draw an otter",
      size: "1024x1024",
      name: "otter",
      signal,
    })

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal)
  })

  test("rejects private provider-returned image URLs", async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      return new Response(JSON.stringify({ data: [{ url: "http://127.0.0.1/private.png" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const provider = new CustomImageProvider({
      options: {
        apiKey: "test-key",
        baseURL: "https://images.example.test/v1",
      },
    })
    await expect(
      provider.generate({
        prompt: "draw an otter",
        size: "1024x1024",
        name: "otter",
      }),
    ).rejects.toThrow("refusing to fetch private/reserved address")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
