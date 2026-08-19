#!/usr/bin/env -S npx tsx

/**
 * Fetches the latest model data from models.dev and updates the local snapshot.
 * Preserves local-only provider entries (CLI wrappers and offline providers)
 * that aren't in the upstream API.
 *
 * Usage:
 *   pnpm --dir packages/ax-code exec tsx script/update-models.ts
 *   # or via pre-commit hook (auto-runs before each commit)
 */

import path from "path"
import { fileURLToPath } from "url"
import { readJson, writeText } from "./fs-compat"
import { cloneJsonValue, formatModelsSnapshot, modelsSnapshotChanged, RETIRED_PROVIDER_IDS } from "./models-snapshot"
import { isHiddenDeepseekLegacySku } from "../src/provider/deepseek-catalog"

const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const snapshotPath = process.env.AX_CODE_MODELS_SNAPSHOT_PATH || path.join(dir, "src/provider/models-snapshot.json")
const modelsUrl = process.env.AX_CODE_MODELS_URL || "https://models.dev"
const modelsFixturePath = process.env.AX_CODE_MODELS_FIXTURE_PATH

async function loadFetchedModels(): Promise<Record<string, any>> {
  if (modelsFixturePath) {
    console.log(`Fetching models from ${modelsFixturePath} ...`)
    return readJson(modelsFixturePath)
  }

  console.log(`Fetching models from ${modelsUrl}/api.json ...`)
  return fetch(`${modelsUrl}/api.json`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .catch((err) => {
      console.error(`Failed to fetch models: ${err.message}`)
      process.exit(0) // don't block commit if network is down
    })
}

const fetched = await loadFetchedModels()

const existing = await readJson<Record<string, any>>(snapshotPath).catch((): Record<string, any> => ({}))

// Retired providers must not survive a refresh, whether they come from the
// upstream catalog or a stale local snapshot.
for (const id of RETIRED_PROVIDER_IDS) {
  delete fetched[id]
  delete existing[id]
}

// Preserve local-only provider entries that models.dev doesn't include
const cliImageProviderIDs = ["claude-code", "codex-cli", "grok-build-cli", "qoder-cli", "kimi-cli"] as const
const localProviderIDs = ["ax-studio", ...cliImageProviderIDs, "ollama"]
for (const id of localProviderIDs) {
  if (existing[id] && !fetched[id]) fetched[id] = cloneJsonValue(existing[id])
}
if (fetched["ax-serving"] && !fetched["ax-studio"]) {
  fetched["ax-studio"] = cloneJsonValue(fetched["ax-serving"])
}
if (!fetched["ax-studio"]) {
  fetched["ax-studio"] = {
    id: "ax-studio",
    name: "AX Studio",
    env: ["AX_STUDIO_HOST"],
    npm: "@ai-sdk/openai-compatible",
    api: "http://localhost:18080/v1",
    doc: "https://github.com/defai-digital/ax-studio",
    models: {},
  }
}
fetched["ax-studio"].id = "ax-studio"
fetched["ax-studio"].name = "AX Studio"
fetched["ax-studio"].env = ["AX_STUDIO_HOST"]
fetched["ax-studio"].npm = "@ai-sdk/openai-compatible"
fetched["ax-studio"].doc = "https://github.com/defai-digital/ax-studio"
if (!fetched["grok-build-cli"]) {
  fetched["grok-build-cli"] = {
    id: "grok-build-cli",
    name: "Grok Build CLI",
    env: [],
    npm: "cli",
    models: {
      "grok-build-cli": {
        id: "grok-build-cli",
        name: "Grok Build CLI",
        family: "grok",
        attachment: true,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-04-16",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 256000,
          output: 10000,
        },
        options: {},
        status: "active",
      },
    },
  }
}
if (!fetched["grok-build-cli"].models?.["grok-build-cli"]) {
  fetched["grok-build-cli"].models = {
    ...(fetched["grok-build-cli"].models ?? {}),
    "grok-build-cli": {
      id: "grok-build-cli",
      name: "Grok Build CLI",
      family: "grok",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-04-16",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 256000,
        output: 10000,
      },
      options: {},
      status: "active",
    },
  }
}
if (!fetched["qoder-cli"]) {
  fetched["qoder-cli"] = {
    id: "qoder-cli",
    name: "Qoder CLI",
    env: [],
    npm: "cli",
    models: {
      "qoder-cli": {
        id: "qoder-cli",
        name: "Qoder CLI",
        family: "qoder",
        attachment: true,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-06-01",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 200000,
          output: 16384,
        },
        options: {},
        status: "active",
      },
    },
  }
}
if (!fetched["qoder-cli"].models?.["qoder-cli"]) {
  fetched["qoder-cli"].models = {
    ...(fetched["qoder-cli"].models ?? {}),
    "qoder-cli": {
      id: "qoder-cli",
      name: "Qoder CLI",
      family: "qoder",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-06-01",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 200000,
        output: 16384,
      },
      options: {},
      status: "active",
    },
  }
}
if (!fetched["kimi-cli"]) {
  fetched["kimi-cli"] = {
    id: "kimi-cli",
    name: "Kimi Code CLI",
    env: [],
    npm: "cli",
    models: {
      "kimi-cli": {
        id: "kimi-cli",
        name: "Kimi Code CLI",
        family: "kimi",
        attachment: true,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-07-01",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 262144,
          output: 16384,
        },
        options: {},
        status: "active",
      },
    },
  }
}
if (!fetched["kimi-cli"].models?.["kimi-cli"]) {
  fetched["kimi-cli"].models = {
    ...(fetched["kimi-cli"].models ?? {}),
    "kimi-cli": {
      id: "kimi-cli",
      name: "Kimi Code CLI",
      family: "kimi",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-07-01",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 262144,
        output: 16384,
      },
      options: {},
      status: "active",
    },
  }
}

// Remove providers we don't support
const removedProviderSources = Object.fromEntries(
  ["moonshotai", "moonshotai-cn", "kimi-for-coding"].flatMap((id) =>
    fetched[id] ? [[id, cloneJsonValue(fetched[id])]] : [],
  ),
)
for (const id of [
  "azure",
  "azure-cognitive-services",
  "openrouter",
  "lmstudio",
  "ax-serving",
  "moonshotai",
  "moonshotai-cn",
  "kimi-for-coding",
  "alibaba",
  "alibaba-cn",
]) {
  delete fetched[id]
}

// Strip unsupported models from every remaining provider — multi-host
// resellers (novita, vercel, baseten, chutes, nano-gpt, ...)
// surface the same upstream models, so a single filter catches all
// hosting variants. Probes match against family, id, and name because
// models.dev tags inconsistently across providers.
//
//   - Kimi (Moonshot): only the current Kimi coding SKU via Alibaba/Kimi plans.
//   - Grok: only grok-4.5 (plus official aliases grok-4.5-latest / grok-build-latest).
//     All other Grok variants (4.3, Build 0.1, code-fast, 4.2/4.1, betas) drop.
//   - GLM (Z.AI): only non-vision selected v5+ SKUs (glm-5.1, glm-5.1[1m],
//     glm-5-turbo, glm-5v, and every glm-4.x / glm-3.x drop), except the
//     documented free PAYG SKU glm-4.7-flash which is re-injected on the
//     zai / zhipuai general APIs after this filter.
//   - Gemini: only v3+ (Gemini 1.x/2.x drops from ax-code's model picker).
//   - GPT-5.5: hidden from API/provider model pickers; use Codex CLI default instead.
//
// To extend: add another entry to UNSUPPORTED_PROBES.
type RawModel = { family?: string; id?: string; name?: string }
function normalizeModelProbe(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
}
function probesOf(m: RawModel): string[] {
  return [m.family, m.id, m.name]
    .filter((s): s is string => typeof s === "string")
    .flatMap((s) => {
      const lower = s.toLowerCase()
      const normalized = normalizeModelProbe(lower)
      return [lower, normalized, normalized.replaceAll("-", "")]
    })
}
function isGrokProbe(probe: string): boolean {
  return /(^|[^a-z0-9])grok([^a-z0-9]|$)/.test(probe) || probe.includes("grok-")
}
// Grok allow-list. Only Grok 4.6/4.5 + official aliases survive; every other
// grok variant is dropped. Match on the final segment so account-prefixed
// reseller ids (e.g. "x-ai/grok-4.5") still resolve. `grok-build-cli` is the
// local CLI bridge model id, not a hosted xAI SKU.
const GROK_ALLOWED_FINAL_SEGMENTS = new Set<string>([
  "grok-4.6",
  "grok-4-6",
  "grok-4.6-latest",
  "grok-4.5",
  "grok-4-5",
  "grok-4.5-latest",
  "grok-build-latest",
  "grok-build-cli",
])
function isAllowedGrokProbe(probe: string): boolean {
  return GROK_ALLOWED_FINAL_SEGMENTS.has(probe.split("/").pop() ?? "")
}
// Kimi models are dropped across the board, except for an explicit allow-list of
// versions that we want to surface (these are served through Alibaba's coding/token
// plan). The allow-list match is exact on the final id segment so partial aliases
// (kimi-k2.6-vision-preview, etc.) keep getting filtered out.
const KIMI_ALLOWED_FINAL_SEGMENTS = new Set<string>(["kimi-k2.7-code"])
function isAllowedKimiProbe(probe: string): boolean {
  return KIMI_ALLOWED_FINAL_SEGMENTS.has(probe.split("/").pop() ?? "")
}
const GLM_HIDDEN_FINAL_SEGMENTS = new Set<string>(["glm-5.1", "glm-5-1", "glm-5.1[1m]", "glm-5.1-1m", "glm-5-turbo"])
const GLM_HIDDEN_FINAL_PATTERN = /(?:^|[^a-z0-9])glm-5[.-]1(?:$|[^0-9])/
function isHiddenGlmProbe(probe: string): boolean {
  const finalSegment = probe.split("/").pop() ?? ""
  return GLM_HIDDEN_FINAL_SEGMENTS.has(finalSegment) || GLM_HIDDEN_FINAL_PATTERN.test(finalSegment)
}
function isUnsupportedModel(m: RawModel): boolean {
  const probes = probesOf(m)
  // Kimi: drop anything tagged kimi unless an allow-listed version matches.
  if (probes.some((p) => p.includes("kimi"))) {
    if (!probes.some(isAllowedKimiProbe)) return true
  }
  // Grok: drop unless an allow-listed final-segment id matches.
  if (probes.some(isGrokProbe)) {
    if (!probes.some(isAllowedGrokProbe)) return true
  }
  // GLM: drop if any probe mentions glm-N where N < 5.
  if (probes.some(isHiddenGlmProbe)) return true
  if (probes.some((p) => p.includes("glm-5v") || p.includes("glm5v"))) return true
  if (probes.some((p) => /\bglm-[0-4]\b/.test(p))) return true
  // Gemini: drop any Gemini generation before 3.
  if (probes.some((p) => /\bgemini-[12](?:\.|-)/.test(p))) return true
  // GPT-5.5: do not expose via API/provider pickers; Codex CLI owns the default model choice.
  if (probes.some((p) => p.includes("gpt-5.5") || p.includes("gpt-5-5") || p.includes("gpt55"))) return true
  return false
}
// GLM-4.7-Flash is the documented free PAYG text SKU on the Z.AI / Zhipu
// general APIs. The global GLM-4.x filter drops it; stash the upstream
// metadata so we can re-inject it onto those two providers only.
const GLM_PAYG_PROVIDER_IDS = ["zai", "zhipuai"] as const
const glm47FlashSources: Record<string, RawModel> = {}
for (const providerID of GLM_PAYG_PROVIDER_IDS) {
  const model = fetched[providerID]?.models?.["glm-4.7-flash"] as RawModel | undefined
  if (model) glm47FlashSources[providerID] = cloneJsonValue(model)
}
for (const [, provider] of Object.entries(fetched) as Array<[string, { models?: Record<string, RawModel> }]>) {
  if (!provider.models) continue
  for (const [mid, model] of Object.entries(provider.models)) {
    if (mid.toLowerCase().startsWith("openrouter/") || model.id?.toLowerCase().startsWith("openrouter/")) {
      delete provider.models[mid]
      continue
    }
    if (isUnsupportedModel(model)) delete provider.models[mid]
  }
}

function groqModel(input: {
  id: string
  name: string
  family: string
  attachment: boolean
  reasoning: boolean
  structuredOutput: boolean
  context: number
  output: number
  releaseDate: string
  inputModalities?: string[]
}) {
  return {
    id: input.id,
    name: input.name,
    family: input.family,
    attachment: input.attachment,
    reasoning: input.reasoning,
    reasoning_options: input.reasoning ? [{ type: "effort", values: ["default"] }] : [],
    tool_call: true,
    structured_output: input.structuredOutput,
    temperature: true,
    release_date: input.releaseDate,
    last_updated: input.releaseDate,
    modalities: {
      input: input.inputModalities ?? ["text"],
      output: ["text"],
    },
    open_weights: true,
    limit: {
      context: input.context,
      output: input.output,
    },
    status: "active",
  } as RawModel
}

function openRouterModel(input: {
  id: string
  name: string
  family: string
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  context: number
  output: number
  releaseDate: string
  inputModalities?: string[]
}) {
  return {
    id: input.id,
    name: input.name,
    family: input.family,
    attachment: input.attachment,
    reasoning: input.reasoning,
    reasoning_options: input.reasoning ? [{ type: "effort", values: ["default"] }] : [],
    tool_call: true,
    structured_output: true,
    temperature: input.temperature,
    release_date: input.releaseDate,
    last_updated: input.releaseDate,
    modalities: {
      input: input.inputModalities ?? ["text"],
      output: ["text"],
    },
    open_weights: false,
    limit: {
      context: input.context,
      output: input.output,
    },
    status: "active",
  } as RawModel
}

// GroqCloud is published by models.dev again. Keep the provider to the
// docs-backed chat allowlist (https://console.groq.com/docs/models): Groq also
// serves speech-to-text (whisper), TTS (orpheus), guardrail classifiers
// (prompt-guard), deprecated llama/allam SKUs no longer in the docs model
// table, server-side "Compound" systems (8k completion, built-in tools only),
// and an enterprise-only MiniMax SKU — none of which a coding agent can drive.
// When models.dev lags or the allowlist filters everything out, fall back to
// the inline docs-backed definitions so the provider never regresses to zero
// models.
const GROQ_CHAT_MODEL_ALLOWLIST = new Set<string>([
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-safeguard-20b",
])
{
  const upstreamModels = (fetched["groq"]?.models ?? {}) as Record<string, RawModel>
  const kept = Object.fromEntries(Object.entries(upstreamModels).filter(([mid]) => GROQ_CHAT_MODEL_ALLOWLIST.has(mid)))
  fetched["groq"] = {
    id: "groq",
    name: "GroqCloud",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.groq.com/openai/v1",
    doc: "https://console.groq.com/docs/models",
    // Docs-backed fallback: qwen3.6-27b caps at 16 384 completion tokens per
    // the Groq models table — NOT the 32 768 an earlier revision carried.
    models:
      Object.keys(kept).length > 0
        ? kept
        : {
            "qwen/qwen3.6-27b": groqModel({
              id: "qwen/qwen3.6-27b",
              name: "Qwen/Qwen3.6-27B",
              family: "qwen",
              attachment: true,
              reasoning: true,
              structuredOutput: false,
              context: 131_072,
              output: 16_384,
              releaseDate: "2026-04-27",
              inputModalities: ["text", "image"],
            }),
            "openai/gpt-oss-120b": groqModel({
              id: "openai/gpt-oss-120b",
              name: "GPT OSS 120B",
              family: "gpt-oss",
              attachment: false,
              reasoning: true,
              structuredOutput: true,
              context: 131_072,
              output: 65_536,
              releaseDate: "2025-08-05",
            }),
            "openai/gpt-oss-20b": groqModel({
              id: "openai/gpt-oss-20b",
              name: "GPT OSS 20B",
              family: "gpt-oss",
              attachment: false,
              reasoning: true,
              structuredOutput: true,
              context: 131_072,
              output: 65_536,
              releaseDate: "2025-08-05",
            }),
            "openai/gpt-oss-safeguard-20b": groqModel({
              id: "openai/gpt-oss-safeguard-20b",
              name: "Safety GPT OSS 20B",
              family: "gpt-oss",
              attachment: false,
              reasoning: true,
              structuredOutput: true,
              context: 131_072,
              output: 65_536,
              releaseDate: "2025-10-29",
            }),
          },
  }
}

// OpenRouter publishes a very broad marketplace catalog. Keep the built-in AX
// Code preset intentionally narrow: only current, text-output models that
// advertise OpenAI-compatible tool calling in OpenRouter's public model API are
// exposed by default. Users can still configure any other OpenRouter model via
// ax-code.json.
fetched["openrouter"] = {
  id: "openrouter",
  name: "OpenRouter",
  env: ["OPENROUTER_API_KEY"],
  npm: "@ai-sdk/openai-compatible",
  api: "https://openrouter.ai/api/v1",
  doc: "https://openrouter.ai/docs/quickstart",
  options: {
    headers: {
      "HTTP-Referer": "https://github.com/defai-digital/ax-code",
      "X-Title": "AX Code",
    },
  },
  models: {
    "openai/gpt-5.2-codex": openRouterModel({
      id: "openai/gpt-5.2-codex",
      name: "OpenRouter: GPT-5.2-Codex",
      family: "gpt",
      attachment: true,
      reasoning: true,
      temperature: false,
      context: 400_000,
      output: 128_000,
      releaseDate: "2026-01-14",
      inputModalities: ["text", "image"],
    }),
    "openai/gpt-5.2": openRouterModel({
      id: "openai/gpt-5.2",
      name: "OpenRouter: GPT-5.2",
      family: "gpt",
      attachment: true,
      reasoning: true,
      temperature: false,
      context: 400_000,
      output: 128_000,
      releaseDate: "2025-12-10",
      inputModalities: ["text", "image", "pdf"],
    }),
    "anthropic/claude-fable-5": openRouterModel({
      id: "anthropic/claude-fable-5",
      name: "OpenRouter: Claude Fable 5",
      family: "claude-fable",
      attachment: true,
      reasoning: true,
      temperature: false,
      context: 1_000_000,
      output: 128_000,
      releaseDate: "2026-06-09",
      inputModalities: ["text", "image", "pdf"],
    }),
    "anthropic/claude-sonnet-4.6": openRouterModel({
      id: "anthropic/claude-sonnet-4.6",
      name: "OpenRouter: Claude Sonnet 4.6",
      family: "claude-sonnet",
      attachment: true,
      reasoning: true,
      temperature: true,
      context: 1_000_000,
      output: 128_000,
      releaseDate: "2026-02-17",
      inputModalities: ["text", "image", "pdf"],
    }),
    "moonshotai/kimi-k2.7-code": openRouterModel({
      id: "moonshotai/kimi-k2.7-code",
      name: "OpenRouter: Kimi K2.7 Code",
      family: "kimi-k2.7-code",
      attachment: true,
      reasoning: true,
      temperature: true,
      context: 262_144,
      output: 16_384,
      releaseDate: "2026-06-12",
      inputModalities: ["text", "image"],
    }),
    "qwen/qwen3-coder-plus": openRouterModel({
      id: "qwen/qwen3-coder-plus",
      name: "OpenRouter: Qwen3 Coder Plus",
      family: "qwen-coder",
      attachment: false,
      reasoning: false,
      temperature: true,
      context: 1_000_000,
      output: 65_536,
      releaseDate: "2025-09-23",
    }),
    "qwen/qwen3-coder-flash": openRouterModel({
      id: "qwen/qwen3-coder-flash",
      name: "OpenRouter: Qwen3 Coder Flash",
      family: "qwen-coder",
      attachment: false,
      reasoning: false,
      temperature: true,
      context: 1_000_000,
      output: 65_536,
      releaseDate: "2025-09-17",
    }),
    "google/gemini-3.5-flash": openRouterModel({
      id: "google/gemini-3.5-flash",
      name: "OpenRouter: Gemini 3.5 Flash",
      family: "gemini",
      attachment: true,
      reasoning: true,
      temperature: true,
      context: 1_048_576,
      output: 65_536,
      releaseDate: "2026-05-19",
      inputModalities: ["text", "image", "audio", "video", "pdf"],
    }),
    "qwen/qwen3.7-plus": openRouterModel({
      id: "qwen/qwen3.7-plus",
      name: "OpenRouter: Qwen3.7 Plus",
      family: "qwen",
      attachment: true,
      reasoning: true,
      temperature: true,
      context: 1_000_000,
      output: 65_536,
      releaseDate: "2026-06-03",
      inputModalities: ["text", "image"],
    }),
    "x-ai/grok-4.5": openRouterModel({
      id: "x-ai/grok-4.5",
      name: "OpenRouter: Grok 4.5",
      family: "grok",
      attachment: true,
      reasoning: true,
      temperature: true,
      context: 500_000,
      output: 500_000,
      releaseDate: "2026-07-08",
      inputModalities: ["text", "image", "pdf"],
    }),
    "z-ai/glm-5.2": openRouterModel({
      id: "z-ai/glm-5.2",
      name: "OpenRouter: GLM 5.2",
      family: "glm",
      attachment: false,
      reasoning: true,
      temperature: true,
      context: 1_048_576,
      output: 32_768,
      releaseDate: "2026-06-16",
    }),
  },
}

if (!fetched["grok-build-cli"].models?.["grok-build-cli"]) {
  fetched["grok-build-cli"].models = {
    ...(fetched["grok-build-cli"].models ?? {}),
    "grok-build-cli": {
      id: "grok-build-cli",
      name: "Grok Build CLI",
      family: "grok",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-04-16",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 256000,
        output: 10000,
      },
      options: {},
      status: "active",
    },
  }
}
if (!fetched["qoder-cli"].models?.["qoder-cli"]) {
  fetched["qoder-cli"].models = {
    ...(fetched["qoder-cli"].models ?? {}),
    "qoder-cli": {
      id: "qoder-cli",
      name: "Qoder CLI",
      family: "qoder",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-06-01",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 200000,
        output: 16384,
      },
      options: {},
      status: "active",
    },
  }
}
if (!fetched["kimi-cli"].models?.["kimi-cli"]) {
  fetched["kimi-cli"].models = {
    ...(fetched["kimi-cli"].models ?? {}),
    "kimi-cli": {
      id: "kimi-cli",
      name: "Kimi Code CLI",
      family: "kimi",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-07-01",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 262144,
        output: 16384,
      },
      options: {},
      status: "active",
    },
  }
}

// CLI wrappers pass images as materialized temp-file paths/URLs to the wrapped
// assistant. Keep their model metadata aligned with that adapter path so the
// common provider transform does not downgrade image parts before the CLI runs.
for (const id of cliImageProviderIDs) {
  const provider = fetched[id]
  const model = provider?.models?.[id]
  if (!model) continue
  model.attachment = true
  const input = Array.isArray(model.modalities?.input) ? model.modalities.input : []
  model.modalities = {
    ...(model.modalities ?? {}),
    input: Array.from(new Set(["text", "image", ...input])),
    output: Array.isArray(model.modalities?.output) ? model.modalities.output : ["text"],
  }
}

function cloneProvider(sourceID: string, targetID: string, overrides: { name: string; api: string; env: string[] }) {
  const source = fetched[sourceID]
  if (!source) return
  fetched[targetID] = {
    ...cloneJsonValue(source),
    id: targetID,
    ...overrides,
  }
}

cloneProvider("alibaba-coding-plan", "alibaba-token-plan", {
  name: "Alibaba Token Plan",
  api: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  env: ["ALIBABA_TOKEN_PLAN_INTL_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
})
cloneProvider("alibaba-coding-plan-cn", "alibaba-token-plan-cn", {
  name: "Alibaba Token Plan (China)",
  api: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  env: ["ALIBABA_TOKEN_PLAN_CN_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
})

// Trim Alibaba plan providers to the curated set of chat/reasoning/image models
// served through each plan. Alibaba enforces exact-string model allowlists that
// DIFFER per plan (verified 2026-08-18 against the official docs):
//   Coding Plan (intl + CN share the same list):
//     https://www.alibabacloud.com/help/en/model-studio/coding-plan
//     qwen3.7-plus, qwen3.6-plus, qwen3.5-plus, qwen3-max-2026-01-23,
//     qwen3-coder-next, qwen3-coder-plus, kimi-k2.5, glm-5, glm-4.7, MiniMax-M2.5
//   Token Plan (Team Edition):
//     https://www.alibabacloud.com/help/en/model-studio/token-plan-overview
//     qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.6-flash, deepseek-v4-*,
//     kimi-k2.7-code/2.6/2.5, glm-5.2/5.1/5, MiniMax-M2.5, qwen-image/wan images.
// Superseded SKUs (kimi-k2.5/k2.6, glm-4.7, glm-5.1, deepseek-v3.2) stay
// excluded per the global supersession filters. Token Plan also hides
// DeepSeek / GLM / MiniMax in ax-code so those vendors are reached via
// their first-party providers (deepseek, zai/zhipuai, minimax), and
// drops any SKU whose id or name contains "preview". Entries
// that models.dev hasn't published yet are silently skipped — the
// whitelists are forward-looking so they appear automatically once
// upstream catches up. Image models (qwen-image-*, wan*) are kept on
// the Token Plan per product intent even though ax-code's chat picker
// can't drive image generation — they show up so callers using the
// provider via SDK / API can pick them.
const alibabaCodingPlanModels = [
  // Qwen text / reasoning (coding-plan exclusive coder SKUs)
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "qwen3-max-2026-01-23",
  "qwen3-coder-next",
  "qwen3-coder-plus",
  // Third-party vendors aggregated under the Coding Plan
  "glm-5",
  "MiniMax-M2.5",
]
const alibabaTokenPlanModels = [
  // Qwen text / reasoning
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.6-flash",
  // Other vendors aggregated under the Token Plan (DeepSeek/GLM/MiniMax
  // stay off this picker — use the first-party providers instead)
  "kimi-k2.7-code",
  // Qwen image generation
  "qwen-image-2.0",
  "qwen-image-2.0-pro",
  // Wan image generation
  "wan2.7-image",
  "wan2.7-image-pro",
]
const alibabaPlanModels: Record<string, string[]> = {
  "alibaba-coding-plan": alibabaCodingPlanModels,
  "alibaba-coding-plan-cn": alibabaCodingPlanModels,
  "alibaba-token-plan": alibabaTokenPlanModels,
  "alibaba-token-plan-cn": alibabaTokenPlanModels,
}
const alibabaModelFallbackProviders: Record<string, string[]> = {
  "qwen3.7-plus": ["llmgateway", "opencode-go", "nano-gpt"],
  "qwen3.6-flash": ["aihubmix"],
  "deepseek-v4-pro": ["auriko", "cortecs", "302ai", "llmgateway"],
  "deepseek-v4-flash": ["cortecs", "auriko", "302ai", "llmgateway"],
  "kimi-k2.7-code": ["moonshot", "moonshot-cn", "302ai", "llmgateway"],
  "glm-5": ["zhipuai"],
  "MiniMax-M2.5": ["minimax", "minimax-cn"],
  "glm-5.2": ["zhipuai"],
}
const alibabaModelFallbackDefaults: Record<string, RawModel> = {
  "kimi-k2.7-code": kimiCodingModel("kimi-k2.7-code", "Kimi K2.7 Code"),
  "qwen-image-2.0": alibabaImageModel("qwen-image-2.0", "Qwen Image 2.0", "qwen-image"),
  "qwen-image-2.0-pro": alibabaImageModel("qwen-image-2.0-pro", "Qwen Image 2.0 Pro", "qwen-image"),
  "wan2.7-image": alibabaImageModel("wan2.7-image", "Wan 2.7 Image", "wan"),
  "wan2.7-image-pro": alibabaImageModel("wan2.7-image-pro", "Wan 2.7 Image Pro", "wan"),
}
function kimiCodingModel(id: string, name: string): RawModel {
  return {
    id,
    name,
    family: id,
    attachment: true,
    reasoning: true,
    tool_call: true,
    interleaved: {
      field: "reasoning_content",
    },
    structured_output: true,
    temperature: true,
    release_date: "2026-06-28",
    last_updated: "2026-06-28",
    modalities: {
      input: ["text", "image", "video"],
      output: ["text"],
    },
    open_weights: true,
    limit: {
      context: 262144,
      output: 262144,
    },
    status: "active",
  } as RawModel
}
function alibabaImageModel(id: string, name: string, family: string): RawModel {
  return {
    id,
    name,
    family,
    attachment: false,
    reasoning: false,
    tool_call: false,
    temperature: true,
    release_date: "2026-06-10",
    modalities: {
      input: ["text"],
      output: ["image"],
    },
    open_weights: false,
    limit: {
      context: 8192,
      output: 1,
    },
    status: "active",
  } as RawModel
}
function withAlibabaModelFallbackDefault(mid: string, model: unknown) {
  const fallback = alibabaModelFallbackDefaults[mid]
  if (!fallback) return cloneJsonValue(model)
  const clonedModel = cloneJsonValue(model) as Record<string, unknown>
  return {
    ...cloneJsonValue(fallback),
    ...clonedModel,
  }
}
for (const [id, planModels] of Object.entries(alibabaPlanModels)) {
  if (!fetched[id]) continue
  const models = fetched[id].models ?? {}
  const kept: Record<string, unknown> = {}
  for (const mid of planModels) {
    if (models[mid]) kept[mid] = withAlibabaModelFallbackDefault(mid, models[mid])
    if (kept[mid]) continue

    const existingModel = existing[id]?.models?.[mid]
    if (existingModel) {
      kept[mid] = withAlibabaModelFallbackDefault(mid, existingModel)
      continue
    }

    for (const fallbackID of alibabaModelFallbackProviders[mid] ?? []) {
      const fallback = fetched[fallbackID]?.models?.[mid] ?? existing[fallbackID]?.models?.[mid]
      if (!fallback) continue
      kept[mid] = withAlibabaModelFallbackDefault(mid, fallback)
      break
    }
    if (!kept[mid] && alibabaModelFallbackDefaults[mid]) {
      kept[mid] = cloneJsonValue(alibabaModelFallbackDefaults[mid])
    }
  }
  fetched[id].models = kept
}

// Token Plan Team Edition allowlist (not Coding Plan): Qwen 3.8 Max.
// Keep the GA id only; the *-preview alias is stripped below.
const tokenPlanOnlyModels = ["qwen3.8-max"] as const
const tokenPlanQwen38 = {
  id: "qwen3.8-max",
  name: "Qwen3.8 Max",
  description:
    "2.4-trillion-parameter multimodal flagship for coding, professional work, and long-horizon agentic workflows",
  family: "qwen",
  attachment: true,
  reasoning: true,
  tool_call: true,
  structured_output: true,
  temperature: true,
  release_date: "2026-08-03",
  last_updated: "2026-08-03",
  modalities: {
    input: ["text", "image", "video"],
    output: ["text"],
  },
  open_weights: false,
  limit: {
    context: 1000000,
    output: 131072,
  },
  status: "active",
} as RawModel
for (const id of ["alibaba-token-plan", "alibaba-token-plan-cn"]) {
  if (!fetched[id]) continue
  const models = fetched[id].models ?? {}
  for (const mid of tokenPlanOnlyModels) {
    if (models[mid]) continue
    const fallback =
      fetched["opencode-go"]?.models?.["qwen3.8-max"] ??
      existing["opencode-go"]?.models?.["qwen3.8-max"] ??
      existing[id]?.models?.[mid]
    const base = fallback ? cloneJsonValue(fallback) : cloneJsonValue(tokenPlanQwen38)
    models[mid] = {
      ...base,
      id: mid,
      name: "Qwen3.8 Max",
      family: "qwen",
    }
    delete (models[mid] as { provider?: unknown }).provider
  }
  for (const [mid, model] of Object.entries(models) as Array<[string, RawModel]>) {
    const probes = [mid, model.id, model.name]
    if (probes.some((probe) => typeof probe === "string" && probe.toLowerCase().includes("preview"))) {
      delete models[mid]
    }
  }
  fetched[id].models = models
}

// Kimi Cloud Plan is a first-party Moonshot endpoint surfaced as a narrow plan
// provider. Keep it separate from the generic upstream Moonshot provider so the
// picker only shows the currently validated coding model instead of every legacy
// Kimi alias published by models.dev.
const kimiCloudPlanModels = ["kimi-k2.7-code"]
const kimiCloudPlanFallbackProviders: Record<string, string[]> = {
  "kimi-k2.7-code": [
    "moonshotai",
    "moonshotai-cn",
    "kimi-for-coding",
    "alibaba-coding-plan",
    "alibaba-token-plan",
    "llmgateway",
    "opencode",
  ],
}
const kimiCloudPlanID = "kimi-cloud-plan"
const kimiCloudPlanKept: Record<string, unknown> = {}
for (const mid of kimiCloudPlanModels) {
  for (const fallbackID of kimiCloudPlanFallbackProviders[mid] ?? []) {
    const fallback =
      fetched[fallbackID]?.models?.[mid] ??
      existing[fallbackID]?.models?.[mid] ??
      removedProviderSources[fallbackID]?.models?.[mid]
    if (!fallback) continue
    kimiCloudPlanKept[mid] = {
      ...cloneJsonValue(kimiCodingModel(mid, "Kimi K2.7 Code")),
      ...cloneJsonValue(fallback),
      id: mid,
      name: "Kimi K2.7 Code",
      family: "kimi-k2.7-code",
    }
    break
  }
  if (!kimiCloudPlanKept[mid] && alibabaModelFallbackDefaults[mid]) {
    kimiCloudPlanKept[mid] = {
      ...cloneJsonValue(alibabaModelFallbackDefaults[mid]),
      id: mid,
      name: "Kimi K2.7 Code",
      family: "kimi-k2.7-code",
    }
  }
}
if (Object.keys(kimiCloudPlanKept).length > 0) {
  fetched[kimiCloudPlanID] = {
    id: kimiCloudPlanID,
    name: "Kimi Cloud Plan",
    env: ["KIMI_CLOUD_PLAN_API_KEY", "MOONSHOT_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.moonshot.ai/v1",
    doc: "https://platform.moonshot.ai/docs/api/chat",
    models: kimiCloudPlanKept,
  }
}

// GLM flagship + 1M-context variants on the Z.AI coding-plan endpoints.
// Z.AI exposes a 1M-token window by appending a "[1m]" suffix to the model
// name (e.g. "glm-5.2[1m]"); the suffix is forwarded verbatim as the
// OpenAI-compatible `model` field, so it is just another model id to ax-code.
// models.dev publishes only the 200K base ids and GLM-5.2 is coding-plan-only
// at launch (general API / open weights ship later), so re-inject the GLM-5.2
// flagship plus the glm-5.2[1m] long-context variant on every regeneration.
// Prefer the upstream entry when models.dev catches up; fall back
// to the template otherwise. Scoped to the coding providers where the [1m]
// suffix is documented (https://docs.z.ai/devpack/latest-model).
const GLM_CODING_PROVIDER_IDS = ["zai-coding-plan", "zhipuai-coding-plan"]
function glmCodingModel(id: string, name: string, context: number, releaseDate: string): RawModel {
  return {
    id,
    name,
    family: "glm",
    attachment: false,
    reasoning: true,
    reasoning_options: [{ type: "toggle" }],
    tool_call: true,
    interleaved: { field: "reasoning_content" },
    structured_output: true,
    temperature: true,
    release_date: releaseDate,
    last_updated: releaseDate,
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context, output: 131072 },
  } as RawModel
}
const glmInjectedModels: Array<{ id: string; name: string; context: number; release: string }> = [
  // GLM-5.3 is the current coding-plan flagship (live for Max/Pro/Lite tiers
  // per https://docs.z.ai/devpack/latest-model); the [1m] suffix unlocks the
  // documented 1M-token window the same way as glm-5.2[1m].
  { id: "glm-5.3", name: "GLM-5.3", context: 1000000, release: "2026-08-14" },
  { id: "glm-5.3[1m]", name: "GLM-5.3 (1M context)", context: 1000000, release: "2026-08-14" },
  { id: "glm-5.2", name: "GLM-5.2", context: 200000, release: "2026-06-13" },
  { id: "glm-5.2[1m]", name: "GLM-5.2 (1M context)", context: 1000000, release: "2026-06-13" },
]
for (const providerID of GLM_CODING_PROVIDER_IDS) {
  const provider = fetched[providerID]
  if (!provider) continue
  const models = (provider.models ?? {}) as Record<string, RawModel>
  const merged: Record<string, RawModel> = {}
  // Surface the injected ids first so they lead the model picker, preferring
  // any richer upstream metadata once models.dev publishes the base id.
  for (const m of glmInjectedModels) {
    merged[m.id] = models[m.id] ?? glmCodingModel(m.id, m.name, m.context, m.release)
  }
  for (const [mid, model] of Object.entries(models)) {
    if (!merged[mid]) merged[mid] = model
  }
  provider.models = merged
}

// General Z.AI / Zhipu PAYG APIs (api.z.ai/api/paas/v4 and
// open.bigmodel.cn/api/paas/v4) get the current GLM flagships — GLM-5.3
// shipped on the general PAYG API (listed on
// https://docs.z.ai/guides/overview/pricing) around the coding-plan launch,
// GLM-5.2 shortly before it. The [1m] long-context variants stay scoped to
// the coding endpoints where the suffix is documented. Inject both
// forward-looking until models.dev publishes them; prefer the upstream entry
// once it does (upstream glm-5.2 already carries the 1M context).
if (!fetched["zai"]) {
  fetched["zai"] = {
    id: "zai",
    name: "Z.AI",
    env: ["ZHIPU_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.z.ai/api/paas/v4",
    doc: "https://docs.z.ai/guides/overview/pricing",
    models: {},
  }
}
for (const providerID of GLM_PAYG_PROVIDER_IDS) {
  const provider = fetched[providerID]
  if (!provider) continue
  const models = (provider.models ?? {}) as Record<string, RawModel>
  const merged: Record<string, RawModel> = {
    "glm-5.3": models["glm-5.3"] ?? glmCodingModel("glm-5.3", "GLM-5.3", 1000000, "2026-08-14"),
    "glm-5.2": models["glm-5.2"] ?? glmCodingModel("glm-5.2", "GLM-5.2", 1000000, "2026-06-13"),
  }
  for (const [mid, model] of Object.entries(models)) {
    if (!merged[mid]) merged[mid] = model
  }
  provider.models = merged
}

// GLM-4.7-Flash is Z.AI's documented free PAYG text model (200k / 128k,
// https://docs.z.ai/guides/overview/pricing). Re-inject it on the general
// APIs only — it is not on the coding-plan endpoints. Prefer stashed
// upstream metadata; fall back to the docs-backed template.
function glm47FlashFreeModel(): RawModel {
  return {
    id: "glm-4.7-flash",
    name: "GLM-4.7-Flash (Free)",
    description: "Budget GLM lane for fast coding help, routing, and everyday automation",
    family: "glm-flash",
    attachment: false,
    reasoning: true,
    reasoning_options: [{ type: "toggle" }],
    tool_call: true,
    interleaved: { field: "reasoning_content" },
    structured_output: true,
    temperature: true,
    knowledge: "2025-04",
    release_date: "2026-01-19",
    last_updated: "2026-01-19",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 200000, output: 131072 },
  } as RawModel
}
for (const providerID of GLM_PAYG_PROVIDER_IDS) {
  const provider = fetched[providerID]
  if (!provider) continue
  const models = (provider.models ?? {}) as Record<string, RawModel>
  const upstream = glm47FlashSources[providerID] ?? models["glm-4.7-flash"]
  models["glm-4.7-flash"] = {
    ...glm47FlashFreeModel(),
    ...(upstream ?? {}),
    id: "glm-4.7-flash",
    name: "GLM-4.7-Flash (Free)",
    tool_call: true,
    structured_output: true,
  } as RawModel
  provider.models = models
}

// Strip cost fields from every model — cost telemetry is removed from
// ax-code, and zod will silently drop these on parse anyway. Removing them
// here keeps the snapshot small and prevents the pre-commit hook from
// re-introducing thousands of dead JSON entries on each regeneration.
// Also strips nested experimental.modes.<name>.cost which models.dev uses
// to surface alternate-mode pricing.
type ModelEntry = {
  cost?: unknown
  experimental?: { modes?: Record<string, { cost?: unknown }> } | unknown
}
for (const provider of Object.values(fetched) as Array<{ models?: Record<string, ModelEntry> }>) {
  for (const model of Object.values(provider.models ?? {})) {
    delete model.cost
    const experimental = model.experimental
    if (experimental && typeof experimental === "object" && "modes" in experimental) {
      const modes = (experimental as { modes?: Record<string, { cost?: unknown }> }).modes
      for (const mode of Object.values(modes ?? {})) {
        delete mode.cost
      }
    }
  }
}

const apiOverrides: Record<string, string> = {
  "alibaba-coding-plan": "https://coding-intl.dashscope.aliyuncs.com/v1",
  "alibaba-coding-plan-cn": "https://coding.dashscope.aliyuncs.com/v1",
  "alibaba-token-plan": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  "alibaba-token-plan-cn": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  "ax-studio": "http://localhost:18080/v1",
  ollama: "http://localhost:11434/v1",
}
for (const [id, api] of Object.entries(apiOverrides)) {
  if (fetched[id]) fetched[id].api = api
}

const docOverrides: Record<string, string> = {
  "alibaba-coding-plan": "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
  "alibaba-coding-plan-cn": "https://help.aliyun.com/zh/model-studio/coding-plan",
  "alibaba-token-plan": "https://www.alibabacloud.com/help/en/model-studio/opencode-token-plan",
  "alibaba-token-plan-cn": "https://help.aliyun.com/zh/model-studio/opencode-token-plan",
  "ax-studio": "https://github.com/defai-digital/ax-studio",
}
for (const [id, doc] of Object.entries(docOverrides)) {
  if (fetched[id]) fetched[id].doc = doc
}

// Force attachment=true on Alibaba multimodal chat models. models.dev reports
// these with input modalities ["text","image","video"] but attachment=false,
// which leaves ax-code's picker refusing image uploads even though the upstream
// API accepts them. Override here so the capability flag matches the modality.
const alibabaAttachmentForceTrue = ["qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus"]
for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  const models = fetched[id]?.models as Record<string, { attachment?: boolean }> | undefined
  if (!models) continue
  for (const mid of alibabaAttachmentForceTrue) {
    const model = models[mid]
    if (model) model.attachment = true
  }
}

// Mark models that have native server-side web search wired in ax-code with a
// 🌐 suffix on their display name so the model picker shows the capability at
// a glance. The suffix is applied to the `name` field only; ids stay stable.
// Re-applied on every regeneration via the endsWith guard so we don't end up
// with "... 🌐 🌐". Other capabilities are NOT marked — this is a deliberate
// narrow opt-in, not a general capability-badge system.
const SEARCH_MARKER = " 🌐"
const LEGACY_SEARCH_PREFIX = "🌐 "
function markSearch(model: { name?: string } | undefined) {
  if (!model?.name) return
  // Clean up any legacy prefix from an earlier marker placement, otherwise we
  // end up with "🌐 Foo 🌐" after the switch from prefix to suffix.
  if (model.name.startsWith(LEGACY_SEARCH_PREFIX)) {
    model.name = model.name.slice(LEGACY_SEARCH_PREFIX.length)
  }
  if (model.name.endsWith(SEARCH_MARKER)) return
  model.name = model.name + SEARCH_MARKER
}
function unmarkSearch(model: { name?: string } | undefined) {
  if (!model?.name) return
  if (model.name.startsWith(LEGACY_SEARCH_PREFIX)) {
    model.name = model.name.slice(LEGACY_SEARCH_PREFIX.length)
  }
  if (model.name.endsWith(SEARCH_MARKER)) {
    model.name = model.name.slice(0, -SEARCH_MARKER.length)
  }
}
function supportsTextOutput(model: { modalities?: { output?: unknown } } | undefined) {
  const output = model?.modalities?.output
  return !Array.isArray(output) || output.includes("text")
}
// Alibaba: every Qwen model on the four plan endpoints accepts `enable_search`.
// Non-Qwen models (DeepSeek/GLM/Kimi/MiniMax) served on the same plans don't
// honor the knob, so they stay unmarked.
for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  const models = fetched[id]?.models as Record<string, { name?: string; modalities?: { output?: unknown } }> | undefined
  if (!models) continue
  for (const [mid, model] of Object.entries(models)) {
    unmarkSearch(model)
    if (mid.toLowerCase().startsWith("qwen") && supportsTextOutput(model)) markSearch(model)
  }
}

const envOverrides: Record<string, string[]> = {
  "alibaba-coding-plan": ["ALIBABA_CODING_PLAN_INTL_API_KEY", "ALIBABA_CODING_PLAN_API_KEY"],
  "alibaba-coding-plan-cn": ["ALIBABA_CODING_PLAN_CN_API_KEY", "ALIBABA_CODING_PLAN_API_KEY"],
  "alibaba-token-plan": ["ALIBABA_TOKEN_PLAN_INTL_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
  "alibaba-token-plan-cn": ["ALIBABA_TOKEN_PLAN_CN_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
  // MiniMax Token Plan (models.dev still uses the legacy *-coding-plan ids).
  // Prefer plan-specific keys so a PAYG MINIMAX_API_KEY does not also light
  // up the subscription providers. Keep MINIMAX_API_KEY as a fallback.
  "minimax-coding-plan": ["MINIMAX_TOKEN_PLAN_API_KEY", "MINIMAX_API_KEY"],
  "minimax-cn-coding-plan": ["MINIMAX_TOKEN_PLAN_CN_API_KEY", "MINIMAX_API_KEY"],
}
for (const [id, env] of Object.entries(envOverrides)) {
  if (fetched[id]) fetched[id].env = env
}

// MiniMax Token Plan (legacy *-coding-plan ids): drop MiniMax-M* SKUs older
// than M2.7. PAYG minimax / minimax-cn keep the full catalog; Alibaba plans
// still serve MiniMax-M2.5 through their own allowlists.
const MINIMAX_PLAN_PROVIDER_IDS = ["minimax-coding-plan", "minimax-cn-coding-plan"] as const
const MINIMAX_PLAN_MIN_VERSION = { major: 2, minor: 7 }
function parseMinimaxMVersion(probe: string): { major: number; minor: number } | undefined {
  const segment = (probe.split("/").pop() ?? probe).toLowerCase()
  const match = segment.match(/^minimax-m(\d+)(?:\.(\d+))?/)
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2] ?? 0) }
}
function isOlderThanMinimaxPlanFloor(model: RawModel, mid: string): boolean {
  for (const probe of [mid, model.id, model.name]) {
    if (typeof probe !== "string") continue
    const version = parseMinimaxMVersion(probe)
    if (!version) continue
    return (
      version.major < MINIMAX_PLAN_MIN_VERSION.major ||
      (version.major === MINIMAX_PLAN_MIN_VERSION.major && version.minor < MINIMAX_PLAN_MIN_VERSION.minor)
    )
  }
  return false
}
for (const id of MINIMAX_PLAN_PROVIDER_IDS) {
  const models = fetched[id]?.models as Record<string, RawModel> | undefined
  if (!models) continue
  for (const [mid, model] of Object.entries(models)) {
    if (isOlderThanMinimaxPlanFloor(model, mid)) delete models[mid]
  }
}

// First-party DeepSeek: hide the legacy chat/reasoner aliases. V4 Flash/Pro
// are the current coding SKUs; chat/reasoner remain on resellers.
const deepseek = fetched["deepseek"] as { models?: Record<string, RawModel> } | undefined
if (deepseek?.models) {
  for (const [mid, model] of Object.entries(deepseek.models)) {
    if (isHiddenDeepseekLegacySku(mid, model.name)) delete deepseek.models[mid]
  }
}

// Inject the 1M-context beta header on Claude models that declare
// limit.context: 1_000_000. models.dev publishes the limit but not the
// header that opts the request into the long-context beta — without the
// header, Anthropic caps the conversation at 200k tokens regardless of
// the snapshot. Re-applied on every regeneration so it survives upstream
// updates. Update the beta name when Anthropic ships a new revision.
const ANTHROPIC_1M_BETA = "context-1m-2025-08-07"
type AnthropicModel = {
  limit?: { context?: number }
  headers?: Record<string, string>
}
const anthropic = fetched["anthropic"] as { models?: Record<string, AnthropicModel> } | undefined
if (anthropic?.models) {
  for (const model of Object.values(anthropic.models)) {
    if (model.limit?.context !== 1_000_000) continue
    const existingBeta = model.headers?.["anthropic-beta"]
    // Trim guards against an empty / whitespace-only upstream value, which
    // would otherwise be preserved verbatim and silently disable the beta.
    const trimmed = existingBeta?.trim()
    const merged = trimmed
      ? trimmed
          .split(",")
          .map((s) => s.trim())
          .includes(ANTHROPIC_1M_BETA)
        ? trimmed
        : `${trimmed},${ANTHROPIC_1M_BETA}`
      : ANTHROPIC_1M_BETA
    model.headers = { ...(model.headers ?? {}), "anthropic-beta": merged }
  }
}

if (!modelsSnapshotChanged(existing, fetched)) {
  console.log("models-snapshot.json is already up to date")
} else {
  await writeText(snapshotPath, formatModelsSnapshot(fetched))
  console.log("Updated models-snapshot.json")
}
