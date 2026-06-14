export const AX_ENGINE_PROVIDER_ID = "ax-engine"
export const AX_ENGINE_MODEL_ID = "qwen3-coder-next"
export const AX_ENGINE_DISPLAY_NAME = "AX Engine (Local)"
export const AX_ENGINE_MODEL_DISPLAY_NAME = "Qwen3-Coder-Next (Local MLX)"
export const AX_ENGINE_DEFAULT_PORT = 18181
export const AX_ENGINE_API_KEY = "local"

export const AX_ENGINE_HF_REPOS = {
  mlx4bit: "mlx-community/Qwen3-Coder-Next-4bit",
  mlx6bit: "mlx-community/Qwen3-Coder-Next-6bit",
} as const

export type AxEngineQuantization = keyof typeof AX_ENGINE_HF_REPOS

export const AX_ENGINE_DEFAULT_QUANTIZATION: AxEngineQuantization = "mlx4bit"

export const AX_ENGINE_ERROR = {
  UnsupportedPlatform: "AX_ENGINE_UNSUPPORTED_PLATFORM",
  UnsupportedArch: "AX_ENGINE_UNSUPPORTED_ARCH",
  UnsupportedMacos: "AX_ENGINE_UNSUPPORTED_MACOS",
  UnsupportedChip: "AX_ENGINE_UNSUPPORTED_CHIP",
  InsufficientMemory: "AX_ENGINE_INSUFFICIENT_MEMORY",
  BinaryMissing: "AX_ENGINE_BINARY_MISSING",
  ModelMissing: "AX_ENGINE_MODEL_MISSING",
  DownloadFailed: "AX_ENGINE_DOWNLOAD_FAILED",
  ServerStartFailed: "AX_ENGINE_SERVER_START_FAILED",
  ServerHealthFailed: "AX_ENGINE_SERVER_HEALTH_FAILED",
  ToolcallUnsupported: "AX_ENGINE_TOOLCALL_UNSUPPORTED",
} as const

export const AX_ENGINE_MIN_MACOS_MAJOR = 26
export const AX_ENGINE_MIN_MEMORY_BYTES = 64 * 1024 ** 3
