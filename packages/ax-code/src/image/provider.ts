import { Log } from "@/util/log"
import { Ssrf } from "@/util/ssrf"

const log = Log.create({ service: "image.provider" })

export interface ImageGenerateInput {
  prompt: string
  size: string
  name: string
  signal?: AbortSignal
}

export interface ImageGenerateOutput {
  data: Buffer
  mimeType: string
}

export interface ImageProvider {
  id: string
  generate(input: ImageGenerateInput): Promise<ImageGenerateOutput>
}

export interface ImageProviderConfig {
  provider?: "openai" | "stability" | "custom"
  options?: {
    apiKey?: string
    baseURL?: string
    model?: string
    [key: string]: unknown
  }
}

function resolveApiKey(config: ImageProviderConfig, envKeys: string[]): string | undefined {
  if (config.options?.apiKey) return config.options.apiKey
  for (const key of envKeys) {
    const val = process.env[key]
    if (val) return val
  }
  return undefined
}

export class OpenAIImageProvider implements ImageProvider {
  readonly id = "openai"
  private apiKey: string
  private baseURL: string
  private model: string

  constructor(config: ImageProviderConfig) {
    const key = resolveApiKey(config, ["OPENAI_API_KEY"])
    if (!key)
      throw new Error(
        "OpenAI image generation requires an API key (set OPENAI_API_KEY or image_generation.options.apiKey).",
      )
    this.apiKey = key
    this.baseURL = config.options?.baseURL ?? "https://api.openai.com/v1"
    this.model = config.options?.model ?? "gpt-image-2"
  }

  async generate(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
    const isDallE = this.model === "dall-e-2" || this.model === "dall-e-3"
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: input.prompt,
      n: 1,
      size: input.size,
      ...(isDallE ? { response_format: "b64_json" } : { output_format: "png" }),
    }
    const response = await fetch(`${this.baseURL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`OpenAI image generation failed (${response.status}): ${body}`)
    }
    const json = (await response.json()) as {
      data?: Array<{ b64_json?: string }>
      output_format?: "png" | "jpeg" | "webp"
    }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new Error("OpenAI image generation returned no image data.")
    const mimeType =
      json.output_format === "jpeg" ? "image/jpeg" : json.output_format === "webp" ? "image/webp" : "image/png"
    return { data: Buffer.from(b64, "base64"), mimeType }
  }
}

export class StabilityImageProvider implements ImageProvider {
  readonly id = "stability"
  private apiKey: string
  private baseURL: string

  constructor(config: ImageProviderConfig) {
    const key = resolveApiKey(config, ["STABILITY_API_KEY"])
    if (!key)
      throw new Error(
        "Stability image generation requires an API key (set STABILITY_API_KEY or image_generation.options.apiKey).",
      )
    this.apiKey = key
    this.baseURL = config.options?.baseURL ?? "https://api.stability.ai"
  }

  async generate(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
    const form = new FormData()
    form.append("prompt", input.prompt)
    form.append("output_format", "png")
    const [width, height] = input.size.split("x").map(Number)
    form.append("aspect_ratio", normalizeAspectRatio(width, height))

    const response = await fetch(`${this.baseURL}/v2beta/stable-image/generate/core`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "image/*",
      },
      body: form,
      signal: input.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Stability image generation failed (${response.status}): ${body}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return { data: Buffer.from(arrayBuffer), mimeType: "image/png" }
  }
}

export class CustomImageProvider implements ImageProvider {
  readonly id = "custom"
  private apiKey: string | undefined
  private baseURL: string
  private model: string | undefined

  constructor(config: ImageProviderConfig) {
    if (!config.options?.baseURL) throw new Error("Custom image provider requires options.baseURL.")
    this.apiKey = config.options.apiKey
    this.baseURL = config.options.baseURL
    this.model = config.options.model
  }

  async generate(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`

    const response = await fetch(`${this.baseURL}/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(this.model ? { model: this.model } : {}),
        prompt: input.prompt,
        n: 1,
        size: input.size,
        response_format: "b64_json",
      }),
      signal: input.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Custom image generation failed (${response.status}): ${body}`)
    }
    const json = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
    const b64 = json.data?.[0]?.b64_json
    if (b64) return { data: Buffer.from(b64, "base64"), mimeType: "image/png" }
    const url = json.data?.[0]?.url
    if (url) {
      // Treat provider-returned URLs as untrusted. A compromised custom
      // endpoint must not turn image download into an SSRF primitive.
      const imgResponse = await Ssrf.pinnedFetch(url, {
        signal: input.signal,
        label: "custom image download",
      })
      if (!imgResponse.ok) throw new Error(`Failed to download generated image from URL (${imgResponse.status}).`)
      const contentType = imgResponse.headers.get("content-type")?.split(";", 1)[0]?.trim()
      const mimeType = contentType === "image/jpeg" || contentType === "image/webp" ? contentType : "image/png"
      return { data: Buffer.from(await imgResponse.arrayBuffer()), mimeType }
    }
    throw new Error("Custom image generation returned no image data.")
  }
}

function normalizeAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height)
  return `${width / d}:${height / d}`
}

export function createImageProvider(config: ImageProviderConfig): ImageProvider {
  const providerID = config.provider ?? detectProvider(config)
  log.info("creating image provider", { provider: providerID })
  switch (providerID) {
    case "openai":
      return new OpenAIImageProvider(config)
    case "stability":
      return new StabilityImageProvider(config)
    case "custom":
      return new CustomImageProvider(config)
  }
}

function detectProvider(config: ImageProviderConfig): "openai" | "stability" | "custom" {
  if (config.options?.baseURL && !config.provider) return "custom"
  if (process.env["STABILITY_API_KEY"] && !process.env["OPENAI_API_KEY"]) return "stability"
  return "openai"
}
