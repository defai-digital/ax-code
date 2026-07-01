export const AX_ENGINE_PROVIDER_ID = "ax-engine"
export const AX_ENGINE_QWEN36_27B_MODEL_ID = "qwen3.6-27b-6bit"
export const AX_ENGINE_QWEN36_35B_MODEL_ID = "qwen3.6-35b-a3b"
export const AX_ENGINE_GEMMA4_12B_MODEL_ID = "gemma-4-12b"
export const AX_ENGINE_GEMMA4_26B_MODEL_ID = "gemma-4-26b"
export const AX_ENGINE_GEMMA4_31B_MODEL_ID = "gemma-4-31b"
export const AX_ENGINE_GLM47_FLASH_MODEL_ID = "glm-4.7-flash"
export const AX_ENGINE_DISPLAY_NAME = "AX Engine (Local)"
export const AX_ENGINE_QWEN36_27B_API_MODEL_ID = "qwen3.6-27b"
export const AX_ENGINE_QWEN36_35B_API_MODEL_ID = "qwen3.6-35b"
export const AX_ENGINE_GEMMA4_12B_API_MODEL_ID = "gemma-4-12b"
export const AX_ENGINE_GEMMA4_26B_API_MODEL_ID = "gemma-4-26b"
export const AX_ENGINE_GEMMA4_31B_API_MODEL_ID = "gemma-4-31b"
export const AX_ENGINE_GLM47_FLASH_API_MODEL_ID = "glm-4.7-flash"
export const AX_ENGINE_QWEN36_27B_MODEL_DISPLAY_NAME = "Qwen3.6-27B 6-bit (Local MLX MTP)"
export const AX_ENGINE_QWEN36_35B_MODEL_DISPLAY_NAME = "Qwen3.6-35B-A3B 6-bit (Local MLX MTP)"
export const AX_ENGINE_GEMMA4_12B_MODEL_DISPLAY_NAME = "Gemma 4 12B 6-bit (Local MLX MTP)"
export const AX_ENGINE_GEMMA4_26B_MODEL_DISPLAY_NAME = "Gemma 4 26B 6-bit (Local MLX MTP)"
export const AX_ENGINE_GEMMA4_31B_MODEL_DISPLAY_NAME = "Gemma 4 31B 6-bit (Local MLX MTP)"
export const AX_ENGINE_GLM47_FLASH_MODEL_DISPLAY_NAME = "GLM 4.7 Flash 6-bit (Local MLX MTP)"
export const AX_ENGINE_DEFAULT_PORT = 18181
export const AX_ENGINE_API_KEY = "local"
export const AX_ENGINE_SPECULATION_PROFILE = "agentic"
export const AX_ENGINE_MTP_MODE = "pure"
export const AX_ENGINE_RECOMMENDED_MEMORY_BYTES = 64 * 1024 ** 3
export const AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES = AX_ENGINE_RECOMMENDED_MEMORY_BYTES

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

// Pinned official darwin-arm64 release of the ax-engine binary, mirroring the
// LSP PINNED_* release pins. `sha256` is the archive digest published on the
// GitHub release (asset `.sha256` and the release manifest); update all fields
// together when bumping the pinned engine version. Set to `undefined` to
// disable the managed install and fall back to the manual-install path. A
// machine can override this via the AX_ENGINE_INSTALL_* env vars without
// editing here.
export const AX_ENGINE_BINARY_RELEASE: AxEngineBinaryRelease | undefined = {
  version: "6.6.0",
  assetName: "ax-engine-v6.6.0-macos-arm64.tar.gz",
  url: "https://github.com/defai-digital/ax-engine/releases/download/v6.6.0/ax-engine-v6.6.0-macos-arm64.tar.gz",
  sha256: "32ba4da8b52dc184f9cbc530c891cd3a9f93c80cc07cefed40399a25db26766f",
}

export const AX_ENGINE_MODEL_IDS = [
  AX_ENGINE_QWEN36_27B_MODEL_ID,
  AX_ENGINE_QWEN36_35B_MODEL_ID,
  AX_ENGINE_GEMMA4_12B_MODEL_ID,
  AX_ENGINE_GEMMA4_26B_MODEL_ID,
  AX_ENGINE_GEMMA4_31B_MODEL_ID,
  AX_ENGINE_GLM47_FLASH_MODEL_ID,
] as const
export type AxEngineModelID = (typeof AX_ENGINE_MODEL_IDS)[number]

export const AX_ENGINE_QUANTIZATION_IDS = ["mlx6bit"] as const
export type AxEngineQuantization = (typeof AX_ENGINE_QUANTIZATION_IDS)[number]

export const AX_ENGINE_MODEL_DEFINITIONS = {
  [AX_ENGINE_QWEN36_27B_MODEL_ID]: {
    id: AX_ENGINE_QWEN36_27B_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN36_27B_API_MODEL_ID,
    name: AX_ENGINE_QWEN36_27B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: 32_768,
    outputTokens: 16_384,
    quantizations: {
      mlx6bit: {
        hfRepo: "mlx-community/Qwen3.6-27B-6bit",
        mtpSource: "Qwen sidecar from Qwen/Qwen3.6-27B",
        minDiskBytes: 96 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_QWEN36_35B_MODEL_ID]: {
    id: AX_ENGINE_QWEN36_35B_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN36_35B_API_MODEL_ID,
    name: AX_ENGINE_QWEN36_35B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: 32_768,
    outputTokens: 16_384,
    quantizations: {
      mlx6bit: {
        hfRepo: "mlx-community/Qwen3.6-35B-A3B-6bit",
        mtpSource: "Qwen sidecar from Qwen/Qwen3.6-35B-A3B",
        minDiskBytes: 96 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GEMMA4_12B_MODEL_ID]: {
    id: AX_ENGINE_GEMMA4_12B_MODEL_ID,
    apiModelID: AX_ENGINE_GEMMA4_12B_API_MODEL_ID,
    name: AX_ENGINE_GEMMA4_12B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    // The Gemma 4 family advertises openai_tool_calling_supported via the
    // ax-engine /v1/models card. Tool calling is a serving-level capability
    // shared across the family, so all three Gemma 4 sizes enable it. Keeping
    // this false starves the session of tools (session/llm.ts gates tool
    // dispatch on capabilities.toolcall) and the model degrades to a tool-less
    // chatbot.
    toolcall: true,
    minMemoryBytes: 0,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx6bit: {
        hfRepo: "mlx-community/gemma-4-12B-it-6bit",
        mtpSource: "assistant package from mlx-community/gemma-4-12B-it-assistant-6bit",
        minDiskBytes: 48 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GEMMA4_26B_MODEL_ID]: {
    id: AX_ENGINE_GEMMA4_26B_MODEL_ID,
    apiModelID: AX_ENGINE_GEMMA4_26B_API_MODEL_ID,
    name: AX_ENGINE_GEMMA4_26B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx6bit: {
        hfRepo: "mlx-community/gemma-4-26b-a4b-it-6bit",
        mtpSource: "assistant package from google/gemma-4-26b-a4b-it-assistant",
        minDiskBytes: 96 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GEMMA4_31B_MODEL_ID]: {
    id: AX_ENGINE_GEMMA4_31B_MODEL_ID,
    apiModelID: AX_ENGINE_GEMMA4_31B_API_MODEL_ID,
    name: AX_ENGINE_GEMMA4_31B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    toolcall: true,
    minMemoryBytes: AX_ENGINE_LARGE_MODEL_MIN_MEMORY_BYTES,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx6bit: {
        hfRepo: "mlx-community/gemma-4-31b-it-6bit",
        mtpSource: "assistant package from google/gemma-4-31b-it-assistant",
        minDiskBytes: 96 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GLM47_FLASH_MODEL_ID]: {
    id: AX_ENGINE_GLM47_FLASH_MODEL_ID,
    apiModelID: AX_ENGINE_GLM47_FLASH_API_MODEL_ID,
    name: AX_ENGINE_GLM47_FLASH_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx6bit",
    toolcall: true,
    minMemoryBytes: 0,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx6bit: {
        hfRepo: "mlx-community/GLM-4.7-Flash-6bit",
        mtpSource: "GLM built-in MTP sidecar from zai-org/GLM-4.7-Flash",
        minDiskBytes: 48 * 1024 ** 3,
      },
    },
  },
} as const

export const AX_ENGINE_DEFAULT_MODEL_ID: AxEngineModelID = AX_ENGINE_QWEN36_27B_MODEL_ID

export const AX_ENGINE_DEFAULT_QUANTIZATION: AxEngineQuantization = "mlx6bit"

export const AX_ENGINE_ERROR = {
  UnsupportedPlatform: "AX_ENGINE_UNSUPPORTED_PLATFORM",
  UnsupportedArch: "AX_ENGINE_UNSUPPORTED_ARCH",
  UnsupportedMacos: "AX_ENGINE_UNSUPPORTED_MACOS",
  UnsupportedChip: "AX_ENGINE_UNSUPPORTED_CHIP",
  InsufficientMemory: "AX_ENGINE_INSUFFICIENT_MEMORY",
  InsufficientDisk: "AX_ENGINE_INSUFFICIENT_DISK",
  BinaryMissing: "AX_ENGINE_BINARY_MISSING",
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
