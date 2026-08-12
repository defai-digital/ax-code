import type { PrivateGpuPathStyle, PrivateGpuVendor } from "./presets"

const TRAILING_SLASH = /\/+$/
const INFERENCE_SUFFIXES = ["/v1/chat/completions", "/v1/completions", "/v1/models", "/chat/completions", "/completions"]
const ARK_INFERENCE_SUFFIXES = [
  "/api/v3/chat/completions",
  "/api/v3/completions",
  "/api/v3/models",
  "/v3/chat/completions",
  "/v3/completions",
  "/v3/models",
  ...INFERENCE_SUFFIXES,
]

function parseHttpUrl(input: string, vendorName: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new Error(`${vendorName} endpoint URL is required`)

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error(`${vendorName} endpoint URL is invalid`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${vendorName} endpoint must be an http or https URL`)
  }
  return url
}

function stripSuffixes(normalized: string, suffixes: string[]) {
  let next = normalized
  for (const suffix of suffixes) {
    if (next.toLowerCase().endsWith(suffix)) {
      next = next.slice(0, -suffix.length).replace(TRAILING_SLASH, "")
      break
    }
  }
  return next
}

function ensureOpenAiV1(normalized: string) {
  return normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1`
}

function normalizeOpenAiV1(url: URL) {
  const stripped = stripSuffixes(url.toString().replace(TRAILING_SLASH, ""), INFERENCE_SUFFIXES)
  return ensureOpenAiV1(stripped)
}

function normalizeRunpod(url: URL) {
  const host = url.hostname.toLowerCase()
  const path = url.pathname.replace(TRAILING_SLASH, "")
  if (host === "api.runpod.ai") {
    const serverless = path.match(/^\/v2\/([^/]+)(?:\/openai(?:\/v1)?)?$/i)
    if (serverless) {
      return `https://api.runpod.ai/v2/${serverless[1]}/openai/v1`
    }
  }
  return normalizeOpenAiV1(url)
}

function normalizeVolcengineArk(url: URL) {
  const stripped = stripSuffixes(url.toString().replace(TRAILING_SLASH, ""), ARK_INFERENCE_SUFFIXES)
  const lower = stripped.toLowerCase()
  if (lower.endsWith("/api/v3") || lower.endsWith("/v3")) return stripped
  return `${stripped}/api/v3`
}

export function normalizePrivateGpuBaseURL(input: string, style: PrivateGpuPathStyle, vendorName: string) {
  const url = parseHttpUrl(input, vendorName)
  if (style === "runpod-openai") return normalizeRunpod(url)
  if (style === "volcengine-ark") return normalizeVolcengineArk(url)
  return normalizeOpenAiV1(url)
}

export function normalizeVendorBaseURL(input: string, vendor: PrivateGpuVendor) {
  return normalizePrivateGpuBaseURL(input, vendor.pathStyle, vendor.name)
}

export function privateGpuModelsURL(baseURL: string, vendor: PrivateGpuVendor) {
  return `${normalizeVendorBaseURL(baseURL, vendor)}/models`
}
