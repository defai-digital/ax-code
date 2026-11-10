import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { parse as parseToml } from "smol-toml"
import { Filesystem } from "../../util/filesystem"
import { parseCliJsonObject, type CliJsonObject } from "./json"
import { codexHome } from "./home"

export interface CliModelInfo {
  model: string
  source: string
}

const DEFAULTS: Record<string, string> = {
  "codex-cli": "codex-cli",
  "grok-build-cli": "grok-build-cli",
  "kimi-cli": "kimi-cli",
  "minimax-cli": "minimax-cli",
  "dsh-cli": "dsh-cli",
}

const KIMI_CODE_LEGACY_MODEL_IDS = new Set(["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"])

export function normalizeKimiCodeModelID(model: string) {
  const trimmed = model.trim()
  return KIMI_CODE_LEGACY_MODEL_IDS.has(trimmed) ? `kimi-code/${trimmed}` : trimmed
}

type JsonLike = CliJsonObject

export function parseCliSettingsJson(text: string): JsonLike | null {
  return parseCliJsonObject(text) ?? null
}

function homeDir() {
  return process.env.AX_CODE_TEST_HOME || homedir()
}

async function readText(path: string): Promise<string | null> {
  const text = await readFile(path, "utf-8").catch((error) => {
    if (Filesystem.isEnoent(error)) return undefined
    throw error
  })
  return text ?? null
}

function resolveTomlModel(toml: string, key: string): string | undefined {
  try {
    // Parsing preserves table scope and ignores model-looking text in strings.
    const value = parseToml(toml)[key]
    return typeof value === "string" ? value.trim() || undefined : undefined
  } catch {
    return undefined
  }
}

export function resolveCodexTomlModel(toml: string): string | undefined {
  return resolveTomlModel(toml, "model")
}

async function resolveCodexModel(): Promise<CliModelInfo> {
  const home = codexHome()
  const toml = await readText(join(home.path, "config.toml"))
  const model = toml ? resolveCodexTomlModel(toml) : undefined
  if (model) return { model, source: `${home.source}/config.toml` }

  return { model: DEFAULTS["codex-cli"]!, source: "default" }
}

async function resolveKimiModelFromConfig(configPath: string, source: string): Promise<CliModelInfo | undefined> {
  const toml = await readText(configPath)
  if (!toml) return
  const model = resolveTomlModel(toml, "default_model")
  if (!model) return
  return { model: normalizeKimiCodeModelID(model), source }
}

async function resolveKimiModel(): Promise<CliModelInfo> {
  const envModel = process.env.KIMI_MODEL?.trim()
  if (envModel) return { model: normalizeKimiCodeModelID(envModel), source: "KIMI_MODEL" }

  // Official Kimi Code CLI home override (current), then legacy share-dir override.
  const codeHome = process.env.KIMI_CODE_HOME?.trim()
  if (codeHome) {
    const fromCodeHome = await resolveKimiModelFromConfig(join(codeHome, "config.toml"), "$KIMI_CODE_HOME/config.toml")
    if (fromCodeHome) return fromCodeHome
  }
  const shareDir = process.env.KIMI_SHARE_DIR?.trim()
  if (shareDir) {
    const fromShareDir = await resolveKimiModelFromConfig(join(shareDir, "config.toml"), "$KIMI_SHARE_DIR/config.toml")
    if (fromShareDir) return fromShareDir
  }

  // Prefer current Kimi Code CLI data dir (~/.kimi-code), fall back to legacy ~/.kimi.
  for (const [relativePath, sourceLabel] of [
    [".kimi-code/config.toml", "~/.kimi-code/config.toml"],
    [".kimi/config.toml", "~/.kimi/config.toml"],
  ] as const) {
    const resolved = await resolveKimiModelFromConfig(join(homeDir(), relativePath), sourceLabel)
    if (resolved) return resolved
  }

  return { model: DEFAULTS["kimi-cli"]!, source: "default" }
}

function minimaxDataDir() {
  const testHome = process.env.AX_CODE_TEST_HOME?.trim()
  if (testHome) return join(testHome, ".minimax")
  const dataDir = process.env.MINIMAX_DATA_DIR?.trim() || process.env.MAVIS_DATA_DIR?.trim()
  if (dataDir) return dataDir
  return join(homeDir(), ".minimax")
}

function resolveYamlDefaultModel(yaml: string): string | undefined {
  const match = yaml.match(/^\s*defaultModel:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value?.trim() || undefined
}

async function resolveMiniMaxModel(): Promise<CliModelInfo> {
  const envModel = process.env.MCODE_MODEL?.trim()
  if (envModel) return { model: envModel, source: "MCODE_MODEL" }

  const configPath = join(minimaxDataDir(), "config.yaml")
  const yaml = await readText(configPath)
  const model = yaml ? resolveYamlDefaultModel(yaml) : undefined
  if (model) {
    const testHome = process.env.AX_CODE_TEST_HOME?.trim()
    const source = testHome
      ? "test-home ~/.minimax/config.yaml"
      : process.env.MINIMAX_DATA_DIR?.trim()
        ? "$MINIMAX_DATA_DIR/config.yaml"
        : process.env.MAVIS_DATA_DIR?.trim()
          ? "$MAVIS_DATA_DIR/config.yaml"
          : "~/.minimax/config.yaml"
    return { model, source }
  }

  return { model: DEFAULTS["minimax-cli"]!, source: "default" }
}

const RESOLVERS: Record<string, () => Promise<CliModelInfo>> = {
  "codex-cli": resolveCodexModel,
  "grok-build-cli": async () => ({ model: DEFAULTS["grok-build-cli"]!, source: "default" }),
  "kimi-cli": resolveKimiModel,
  "minimax-cli": resolveMiniMaxModel,
  // dsh headless has no model flag; the profile's model route decides.
  "dsh-cli": async () => ({ model: DEFAULTS["dsh-cli"]!, source: "default" }),
}

export async function resolveCliModel(providerID: string): Promise<CliModelInfo> {
  const resolver = Object.hasOwn(RESOLVERS, providerID) ? RESOLVERS[providerID] : undefined
  if (!resolver) return { model: "unknown", source: "none" }
  return resolver()
}
