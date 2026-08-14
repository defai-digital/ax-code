export const AX_ENGINE_PROVIDER_ID = "ax-engine"
export const AX_ENGINE_QWEN36_27B_AXQ_MODEL_ID = "qwen3.6-27b-axq-6bit"
export const AX_ENGINE_ORNITH_35B_AXQ_MODEL_ID = "ornith-35b"
export const AX_ENGINE_QWEN35_9B_AXQ_MODEL_ID = "qwen3.5-9b-axq-6bit"
export const AX_ENGINE_QWEN3_CODER_NEXT_AXQ_MODEL_ID = "qwen3-coder-next-axq-6bit"
export const AX_ENGINE_DISPLAY_NAME = "AX Engine (Local)"
export const AX_ENGINE_QWEN36_27B_AXQ_API_MODEL_ID = "qwen3.6-27b-axq"
export const AX_ENGINE_ORNITH_35B_AXQ_API_MODEL_ID = "ornith-35b"
export const AX_ENGINE_QWEN35_9B_AXQ_API_MODEL_ID = "qwen3.5-9b-axq"
export const AX_ENGINE_QWEN3_CODER_NEXT_AXQ_API_MODEL_ID = "qwen3-coder-next-axq"
export const AX_ENGINE_QWEN36_27B_AXQ_MODEL_DISPLAY_NAME = "Qwen3.6-27B AXQ 6-bit (Local MLX Auto)"
export const AX_ENGINE_ORNITH_35B_AXQ_MODEL_DISPLAY_NAME = "Ornith-1.0-35B AXQ 4-bit (Local MLX)"
export const AX_ENGINE_QWEN35_9B_AXQ_MODEL_DISPLAY_NAME = "Qwen3.5-9B AXQ 6-bit (Local MLX Auto)"
export const AX_ENGINE_QWEN3_CODER_NEXT_AXQ_MODEL_DISPLAY_NAME = "Qwen3-Coder-Next AXQ 6-bit (Local MLX)"
// Keep the client default aligned with ax-engine-server. Managed lifecycle may
// still select 31419+ when another process owns the preferred port.
export const AX_ENGINE_DEFAULT_PORT = 31418
export const AX_ENGINE_API_KEY = "local"
export const AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS = 2_048
export const AX_ENGINE_MIN_VERSION = "6.11.0"
export const AX_ENGINE_SPECULATION_PROFILE = "agentic"
export const AX_ENGINE_MTP_MODE = "pure"
export const AX_ENGINE_RECOMMENDED_MEMORY_BYTES = 64 * 1024 ** 3
export const AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES = AX_ENGINE_RECOMMENDED_MEMORY_BYTES
export const AX_ENGINE_CODING_MODEL_MIN_MEMORY_BYTES = 96 * 1024 ** 3

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
  AX_ENGINE_QWEN36_27B_AXQ_MODEL_ID,
  AX_ENGINE_ORNITH_35B_AXQ_MODEL_ID,
  AX_ENGINE_QWEN35_9B_AXQ_MODEL_ID,
  AX_ENGINE_QWEN3_CODER_NEXT_AXQ_MODEL_ID,
] as const
export type AxEngineModelID = (typeof AX_ENGINE_MODEL_IDS)[number]

export const AX_ENGINE_QUANTIZATION_IDS = ["mlx6bit", "mlx4bit"] as const
export type AxEngineQuantization = (typeof AX_ENGINE_QUANTIZATION_IDS)[number]

/** Absolute source path (repo-relative) for the managed model catalog contract. */
export const AX_ENGINE_CATALOG_SOURCE = "packages/ax-code/src/provider/ax-engine/constants.ts" as const

export const AX_ENGINE_MODEL_DEFINITIONS = {
  // Pre-packaged AutomatosX AXQuant (AXQ) 6-bit + MTP snapshot. Direct HF download
  // (not download-mtp) because the hub package already ships model-manifest.json and
  // the AXQuant MTP sidecar contract.
  [AX_ENGINE_QWEN36_27B_AXQ_MODEL_ID]: {
    id: AX_ENGINE_QWEN36_27B_AXQ_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN36_27B_AXQ_API_MODEL_ID,
    name: AX_ENGINE_QWEN36_27B_AXQ_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    releaseDate: "2026-06-14",
    reasoning: false,
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: 65_536,
    outputTokens: AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS,
    quantizations: {
      mlx6bit: {
        hfRepo: "AutomatosX/AX-Qwen3.6-27B-MLX-AXQ-6bit-MTP",
        downloadMode: "direct",
        packageMarker: "axquant_mtp_sidecar_manifest.json",
        directFallback: true,
        mtpSource: "AXQuant MTP sidecar packaged with AutomatosX/AX-Qwen3.6-27B-MLX-AXQ-6bit-MTP",
        // ~21 GB complete download; keep headroom for HF snapshot + temp files.
        minDiskBytes: 32 * 1024 ** 3,
      },
    },
  },
  // Development AXQuant 4-bit Ornith pack. The source model advertises a
  // 262,144-token window and native Qwen-style reasoning/tool calls. It has no
  // MTP sidecar, so AX Engine uses the direct decode path.
  [AX_ENGINE_ORNITH_35B_AXQ_MODEL_ID]: {
    id: AX_ENGINE_ORNITH_35B_AXQ_MODEL_ID,
    apiModelID: AX_ENGINE_ORNITH_35B_AXQ_API_MODEL_ID,
    name: AX_ENGINE_ORNITH_35B_AXQ_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    releaseDate: "2026-08-13",
    reasoning: true,
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: 262_144,
    outputTokens: AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS,
    quantizations: {
      mlx4bit: {
        hfRepo: "AutomatosX/AX-Ornith-1.0-35B-MLX-AXQ-4bit",
        downloadMode: "direct",
        packageMarker: undefined,
        directFallback: true,
        mtpSource: "Direct decode AXQuant Ornith coding model (no MTP package)",
        // ~21.5 GB complete download; keep headroom for the HF snapshot and
        // temporary files created while AX Engine prepares the model.
        minDiskBytes: 32 * 1024 ** 3,
      },
    },
  },
  // Lighter AutomatosX AXQ 9B pack with MTP sidecar. Direct HF download; hub
  // ships axquant_mtp_sidecar_manifest.json but not model-manifest.json (ax-engine
  // emits the native manifest after download).
  [AX_ENGINE_QWEN35_9B_AXQ_MODEL_ID]: {
    id: AX_ENGINE_QWEN35_9B_AXQ_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN35_9B_AXQ_API_MODEL_ID,
    name: AX_ENGINE_QWEN35_9B_AXQ_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    releaseDate: "2026-06-14",
    reasoning: false,
    toolcall: true,
    minMemoryBytes: 0,
    contextTokens: 32_768,
    outputTokens: AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS,
    quantizations: {
      mlx6bit: {
        hfRepo: "AutomatosX/AX-Qwen3.5-9B-MLX-AXQ-6bit-MTP",
        downloadMode: "direct",
        packageMarker: "axquant_mtp_sidecar_manifest.json",
        directFallback: true,
        mtpSource: "AXQuant MTP sidecar packaged with AutomatosX/AX-Qwen3.5-9B-MLX-AXQ-6bit-MTP",
        // ~8.4 GB complete download; keep headroom for HF snapshot + temp files.
        minDiskBytes: 16 * 1024 ** 3,
      },
    },
  },
  // AutomatosX AXQuant 6-bit coding specialist. Direct HF download; hub package
  // has no MTP sidecar and no pre-shipped model-manifest.json (ax-engine emits
  // the native manifest after download).
  [AX_ENGINE_QWEN3_CODER_NEXT_AXQ_MODEL_ID]: {
    id: AX_ENGINE_QWEN3_CODER_NEXT_AXQ_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN3_CODER_NEXT_AXQ_API_MODEL_ID,
    name: AX_ENGINE_QWEN3_CODER_NEXT_AXQ_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    releaseDate: "2026-06-14",
    reasoning: false,
    toolcall: true,
    minMemoryBytes: AX_ENGINE_CODING_MODEL_MIN_MEMORY_BYTES,
    contextTokens: 16_384,
    outputTokens: AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS,
    quantizations: {
      mlx6bit: {
        hfRepo: "AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit",
        downloadMode: "direct",
        packageMarker: undefined,
        directFallback: true,
        mtpSource: "Direct decode AXQuant coding specialist (no MTP package)",
        // ~60 GB complete download; keep headroom for HF snapshot + temp files.
        minDiskBytes: 80 * 1024 ** 3,
      },
    },
  },
} as const

export const AX_ENGINE_DEFAULT_MODEL_ID: AxEngineModelID = AX_ENGINE_QWEN36_27B_AXQ_MODEL_ID

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
