export const AX_ENGINE_PROVIDER_ID = "ax-engine"
// The supported local lineup is exactly three AXQuant families, 6-bit only:
// Qwen3.8-27B (MTP), Ornith-1.0-35B, and Qwen3-Coder-Next. The 4-bit packs
// were dropped from the catalog — 6-bit is the only supported quantization.
export const AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID = "qwen3.8-27b-axq-6bit"
export const AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID = "ornith-35b-axq-6bit"
export const AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID = "qwen3-coder-next-axq-6bit"
export const AX_ENGINE_DISPLAY_NAME = "AX Engine (Local)"
// Keep the client default aligned with ax-engine-server. Managed lifecycle may
// still select 31419+ when another process owns the preferred port.
export const AX_ENGINE_DEFAULT_PORT = 31418
export const AX_ENGINE_API_KEY = "local"
// 2 048 proved too small for agentic turns: a single long tool call (e.g. a
// find/wc pipeline with exclusions) plus its reasoning preamble saturates the
// budget and the JSON arguments are cut mid-string, forcing the truncated-turn
// recovery loop to burn extra turns. 8 192 is the fallback budget and the
// scheduler width kept for split-knob servers; each catalog model advertises
// its own outputTokens tuned to its context window (up to the 32 000
// OUTPUT_TOKEN_MAX request-layer ceiling in provider/transform.ts, matching
// the opencode/Claude Code agentic default).
export const AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS = 8_192
export const AX_ENGINE_MIN_VERSION = "6.11.0"
// First ax-engine version whose server accepts --max-output-tokens: the
// advertised per-request output budget, split from --max-batch-tokens (the
// scheduler's per-step width). Older binaries only know the conflated knob,
// so they keep receiving the per-model budget as --max-batch-tokens.
export const AX_ENGINE_MAX_OUTPUT_TOKENS_FLAG_MIN_VERSION = "7.1.0"
export const AX_ENGINE_SPECULATION_PROFILE = "agentic"
export const AX_ENGINE_MTP_MODE = "pure"
export const AX_ENGINE_RECOMMENDED_MEMORY_BYTES = 64 * 1024 ** 3
export const AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES = AX_ENGINE_RECOMMENDED_MEMORY_BYTES
export const AX_ENGINE_CODING_MODEL_MIN_MEMORY_BYTES = 96 * 1024 ** 3

// Managed servers default to one in-flight request: AX Code owns a single
// foreground agent stream, and serializing engine jobs keeps a cancelled stream
// from racing a retry against shared prefix/speculation state. Power users on
// high-memory hosts can opt into more via provider options
// (`provider.ax-engine.options.maxConcurrentRequests` in ax-code.json) or the
// AX_ENGINE_MAX_CONCURRENT_REQUESTS env var.
export const AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS = 1
export const AX_ENGINE_MAX_CONCURRENT_REQUESTS_ENV = "AX_ENGINE_MAX_CONCURRENT_REQUESTS"

function parseMaxConcurrentRequests(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() ? Number(value.trim()) : value
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 1) return undefined
  return parsed
}

export function resolveAxEngineMaxConcurrentRequests(options: Record<string, unknown> = {}) {
  return (
    parseMaxConcurrentRequests(options.maxConcurrentRequests) ??
    parseMaxConcurrentRequests(process.env[AX_ENGINE_MAX_CONCURRENT_REQUESTS_ENV]) ??
    AX_ENGINE_DEFAULT_MAX_CONCURRENT_REQUESTS
  )
}

export function resolveAxEngineApiKey(options: Record<string, unknown> = {}, savedKey?: unknown) {
  const saved = typeof savedKey === "string" && savedKey.trim() ? savedKey.trim() : undefined
  const configured = typeof options.apiKey === "string" && options.apiKey.trim() ? options.apiKey.trim() : undefined
  const environment = process.env.AX_ENGINE_API_KEY?.trim()
  return saved ?? configured ?? (environment || undefined) ?? AX_ENGINE_API_KEY
}

// --- Managed binary install ------------------------------------------------
// AX Code can download and install the `ax-engine` binary itself (not just the
// model weights) so selecting local inference on an eligible Mac works without
// a manual install step. See provider/ax-engine/install.ts.

// Filename of the ax-engine executable inside a release archive and in the
// managed install directory.
export const AX_ENGINE_MANAGED_BINARY_NAME = "ax-engine"

// Optional Apple Developer ID Team the installer can additionally require a
// downloaded binary to be codesigned by. AX Engine release binaries are ad-hoc
// signed (no Team identifier) and distributed with minisign signatures rather
// than Apple notarization, so this is empty by default — only the SHA-256 and
// ad-hoc `codesign --verify` integrity checks apply. Set AX_ENGINE_INSTALL_TEAM_ID
// to additionally enforce a specific team for a Developer-ID-signed build.
export const AX_ENGINE_EXPECTED_TEAM_ID = ""

// Environment overrides that point the installer at a specific ax-engine
// release without a code change (power users / pre-release testing).
export const AX_ENGINE_INSTALL_ENV = {
  url: "AX_ENGINE_INSTALL_URL",
  sha256: "AX_ENGINE_INSTALL_SHA256",
  version: "AX_ENGINE_INSTALL_VERSION",
  teamId: "AX_ENGINE_INSTALL_TEAM_ID",
} as const

export type AxEngineBinaryRelease = {
  version: string
  // Archive filename (must be a .tar.* or .zip containing `ax-engine` at the
  // top level). Drives extraction and the on-disk temp name.
  assetName: string
  url: string
  sha256?: string
  teamId?: string
}

// Managed installation is intentionally disabled until the release archive is
// self-contained. The v6.9.0 raw archive omits the matching MLX dylibs and
// metallib, so it can pass checksum/codesign/doctor checks and still fail on a
// clean Mac at the first real model load. The Homebrew formula installs the
// matching runtime and remains the supported macOS path. AX_ENGINE_INSTALL_*
// overrides stay available for validating a future self-contained artifact.
export const AX_ENGINE_BINARY_RELEASE: AxEngineBinaryRelease | undefined = undefined

// Single source of truth for the built-in AX Engine model catalog exposed by
// `/provider/ax-engine/models`, Desktop Models, and provider pickers. Desktop and
// other clients must not hardcode model ids — they read this catalog from the
// ax-code process that is currently serving. Editing this file only affects a
// Desktop session when that session spawns this monorepo's ax-code (desktop:dev
// prefers the monorepo source launcher over Homebrew/PATH installs).
export const AX_ENGINE_MODEL_IDS = [
  AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
  AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID,
  AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID,
] as const
export type AxEngineModelID = (typeof AX_ENGINE_MODEL_IDS)[number]

// Managed serving policy, intentionally model-specific rather than normalized
// to a cloud-provider context tier. These values drive both the provider's
// advertised limit and the AX Engine KV-cache block capacity:
// - Qwen3.8-27B: 64K daily-driver window
// - Ornith-1.0-35B: full 256K long-context window
// - Qwen3-Coder-Next: 32K memory-safe coding window
export const AX_ENGINE_MODEL_CONTEXT_TOKENS = {
  [AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID]: 65_536,
  [AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID]: 262_144,
  [AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID]: 32_768,
} as const satisfies Record<AxEngineModelID, number>

export const AX_ENGINE_QUANTIZATION_IDS = ["mlx6bit"] as const
export type AxEngineQuantization = (typeof AX_ENGINE_QUANTIZATION_IDS)[number]

/** Absolute source path (repo-relative) for the managed model catalog contract. */
export const AX_ENGINE_CATALOG_SOURCE = "packages/ax-code/src/provider/ax-engine/constants.ts" as const

export type AxEngineQuantizationDefinition = {
  hfRepo: string
  downloadMode: "direct" | "mtp"
  packageMarker: string | undefined
  directFallback: boolean
  mtpSource: string
  minDiskBytes: number
}

export type AxEngineModelDefinition = {
  id: AxEngineModelID
  apiModelID: string
  name: string
  defaultQuantization: AxEngineQuantization
  releaseDate: string
  reasoning: boolean
  toolcall: boolean
  minMemoryBytes: number
  /** Managed provider/server context cap from AX_ENGINE_MODEL_CONTEXT_TOKENS. */
  contextTokens: number
  outputTokens: number
  /** Each catalog model ships exactly one quantization today; the map shape keeps room for more. */
  quantizations: Partial<Record<AxEngineQuantization, AxEngineQuantizationDefinition>>
}

export const AX_ENGINE_MODEL_DEFINITIONS: Record<AxEngineModelID, AxEngineModelDefinition> = {
  // Qwen3.8-27B AXQuant + MTP snapshots. Direct HF download: the hub packages
  // ship model-manifest.json and the AXQuant MTP sidecar contract.
  [AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID]: {
    id: AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
    name: "Qwen3.8-27B AXQ 6-bit (Local MLX Auto)",
    defaultQuantization: "mlx6bit",
    releaseDate: "2026-08-14",
    reasoning: false,
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: AX_ENGINE_MODEL_CONTEXT_TOKENS[AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID],
    // 16 384 covers whole-file writes without finish=length truncation while
    // keeping 49 152 tokens (75%) of the window for the prompt.
    outputTokens: 16_384,
    quantizations: {
      mlx6bit: {
        hfRepo: "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP",
        downloadMode: "direct",
        packageMarker: "axquant_mtp_sidecar_manifest.json",
        directFallback: true,
        mtpSource: "AXQuant MTP sidecar packaged with AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP",
        // ~19.4 GiB complete download; keep headroom for HF snapshot + temp files.
        minDiskBytes: 32 * 1024 ** 3,
      },
    },
  },
  // Ornith 1.0 35B AXQuant packs. 262,144-token window with native Qwen-style
  // reasoning/tool calls. No MTP sidecar, so AX Engine uses the direct decode
  // path (ax-engine emits the native manifest after download).
  [AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID]: {
    id: AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID,
    apiModelID: AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID,
    name: "Ornith-1.0-35B AXQ 6-bit (Local MLX)",
    defaultQuantization: "mlx6bit",
    releaseDate: "2026-08-13",
    reasoning: true,
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: AX_ENGINE_MODEL_CONTEXT_TOKENS[AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID],
    // The 262 144-token window easily affords the largest budget the request
    // layer allows: 32 000 == OUTPUT_TOKEN_MAX (provider/transform.ts), the
    // opencode/Claude Code agentic default. Catalog, server
    // (--max-output-tokens), and request max_tokens stay aligned.
    outputTokens: 32_000,
    quantizations: {
      mlx6bit: {
        hfRepo: "AutomatosX/AX-Ornith-1.0-35B-MLX-AXQ-6bit",
        downloadMode: "direct",
        packageMarker: undefined,
        directFallback: true,
        mtpSource: "Direct decode AXQuant Ornith coding model (no MTP package)",
        // ~24.5 GiB complete download; keep headroom for HF snapshot + temp files.
        minDiskBytes: 36 * 1024 ** 3,
      },
    },
  },
  // Qwen3-Coder-Next AXQuant coding specialist packs. No MTP sidecar and no
  // pre-shipped model-manifest.json (ax-engine emits the native manifest after
  // download).
  [AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID]: {
    id: AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID,
    name: "Qwen3-Coder-Next AXQ 6-bit (Local MLX)",
    defaultQuantization: "mlx6bit",
    releaseDate: "2026-06-14",
    reasoning: false,
    toolcall: true,
    minMemoryBytes: AX_ENGINE_CODING_MODEL_MIN_MEMORY_BYTES,
    // Qwen3-Coder-Next is a 256K-native 80B-A3B MoE; SGLang's local-serving
    // docs recommend --context-length 32768 as the memory-safe setting, and the
    // KV cache stays small next to the ~55.7 GiB weights on 96 GB+ hosts.
    contextTokens: AX_ENGINE_MODEL_CONTEXT_TOKENS[AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID],
    // 16 384 covers whole-file writes without finish=length truncation (8 192
    // was the observed truncation threshold on agentic turns); the input
    // budget stays usable at 16 384 tokens.
    outputTokens: 16_384,
    quantizations: {
      mlx6bit: {
        hfRepo: "AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit",
        downloadMode: "direct",
        packageMarker: undefined,
        directFallback: true,
        mtpSource: "Direct decode AXQuant coding specialist (no MTP package)",
        // ~55.7 GiB complete download; keep headroom for HF snapshot + temp files.
        minDiskBytes: 80 * 1024 ** 3,
      },
    },
  },
}

export const AX_ENGINE_DEFAULT_MODEL_ID: AxEngineModelID = AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID

export const AX_ENGINE_DEFAULT_QUANTIZATION: AxEngineQuantization = "mlx6bit"

export const AX_ENGINE_ERROR = {
  UnsupportedPlatform: "AX_ENGINE_UNSUPPORTED_PLATFORM",
  UnsupportedArch: "AX_ENGINE_UNSUPPORTED_ARCH",
  UnsupportedMacos: "AX_ENGINE_UNSUPPORTED_MACOS",
  UnsupportedChip: "AX_ENGINE_UNSUPPORTED_CHIP",
  InsufficientMemory: "AX_ENGINE_INSUFFICIENT_MEMORY",
  InsufficientDisk: "AX_ENGINE_INSUFFICIENT_DISK",
  BinaryMissing: "AX_ENGINE_BINARY_MISSING",
  VersionUnsupported: "AX_ENGINE_VERSION_UNSUPPORTED",
  ModelMissing: "AX_ENGINE_MODEL_MISSING",
  ModelNotPrepared: "AX_ENGINE_MODEL_NOT_PREPARED",
  DownloadFailed: "AX_ENGINE_DOWNLOAD_FAILED",
  ServerStartFailed: "AX_ENGINE_SERVER_START_FAILED",
  ServerHealthFailed: "AX_ENGINE_SERVER_HEALTH_FAILED",
  ToolcallUnsupported: "AX_ENGINE_TOOLCALL_UNSUPPORTED",
} as const

export const AX_ENGINE_MIN_MACOS_MAJOR = 26
export const AX_ENGINE_MIN_MEMORY_BYTES = 0

export function isAxEngineModelID(value: unknown): value is AxEngineModelID {
  return typeof value === "string" && AX_ENGINE_MODEL_IDS.includes(value as AxEngineModelID)
}
