export const AX_ENGINE_PROVIDER_ID = "ax-engine"
export const AX_ENGINE_QWEN3_CODER_NEXT_MODEL_ID = "qwen3-coder-next"
export const AX_ENGINE_QWEN36_35B_MODEL_ID = "qwen3.6-35b-a3b"
export const AX_ENGINE_GEMMA4_12B_MODEL_ID = "gemma-4-12b"
export const AX_ENGINE_GEMMA4_26B_MODEL_ID = "gemma-4-26b-a4b"
export const AX_ENGINE_GEMMA4_31B_MODEL_ID = "gemma-4-31b"
export const AX_ENGINE_QWEN36_27B_MODEL_ID = "qwen3.6-27b"
export const AX_ENGINE_QWEN35_9B_MODEL_ID = "qwen3.5-9b"
export const AX_ENGINE_GLM47_MODEL_ID = "glm-4.7"
export const AX_ENGINE_DISPLAY_NAME = "AX Engine (Local)"
export const AX_ENGINE_QWEN3_CODER_NEXT_API_MODEL_ID = "qwen3"
export const AX_ENGINE_QWEN36_35B_API_MODEL_ID = "qwen3.6-35b"
export const AX_ENGINE_GEMMA4_12B_API_MODEL_ID = "gemma-4-12b"
export const AX_ENGINE_GEMMA4_26B_API_MODEL_ID = "gemma-4-26b-a4b"
export const AX_ENGINE_GEMMA4_31B_API_MODEL_ID = "gemma-4-31b"
export const AX_ENGINE_QWEN36_27B_API_MODEL_ID = "qwen3.6-27b"
export const AX_ENGINE_QWEN35_9B_API_MODEL_ID = "qwen3.5-9b"
export const AX_ENGINE_GLM47_API_MODEL_ID = "glm-4.7"
export const AX_ENGINE_QWEN3_CODER_NEXT_MODEL_DISPLAY_NAME = "Qwen3-Coder-Next (Local MLX)"
export const AX_ENGINE_QWEN36_35B_MODEL_DISPLAY_NAME = "Qwen3.6-35B-A3B 4-bit (Local MLX)"
export const AX_ENGINE_GEMMA4_12B_MODEL_DISPLAY_NAME = "Gemma 4 12B 4-bit (Local MLX)"
export const AX_ENGINE_GEMMA4_26B_MODEL_DISPLAY_NAME = "Gemma 4 26B-A4B 4-bit (Local MLX)"
export const AX_ENGINE_GEMMA4_31B_MODEL_DISPLAY_NAME = "Gemma 4 31B 4-bit (Local MLX)"
export const AX_ENGINE_QWEN36_27B_MODEL_DISPLAY_NAME = "Qwen3.6-27B 4-bit (Local MLX)"
export const AX_ENGINE_QWEN35_9B_MODEL_DISPLAY_NAME = "Qwen3.5-9B 4-bit (Local MLX)"
export const AX_ENGINE_GLM47_MODEL_DISPLAY_NAME = "GLM 4.7 4-bit (Local MLX)"
export const AX_ENGINE_DEFAULT_PORT = 18181
export const AX_ENGINE_API_KEY = "local"

export const AX_ENGINE_MODEL_IDS = [
  AX_ENGINE_QWEN3_CODER_NEXT_MODEL_ID,
  AX_ENGINE_QWEN36_35B_MODEL_ID,
  AX_ENGINE_GEMMA4_12B_MODEL_ID,
  AX_ENGINE_GEMMA4_26B_MODEL_ID,
  AX_ENGINE_GEMMA4_31B_MODEL_ID,
  AX_ENGINE_QWEN36_27B_MODEL_ID,
  AX_ENGINE_QWEN35_9B_MODEL_ID,
  AX_ENGINE_GLM47_MODEL_ID,
] as const
export type AxEngineModelID = (typeof AX_ENGINE_MODEL_IDS)[number]

export const AX_ENGINE_QUANTIZATION_IDS = ["mlx4bit", "mlx6bit"] as const
export type AxEngineQuantization = (typeof AX_ENGINE_QUANTIZATION_IDS)[number]

export const AX_ENGINE_MODEL_DEFINITIONS = {
  [AX_ENGINE_QWEN3_CODER_NEXT_MODEL_ID]: {
    id: AX_ENGINE_QWEN3_CODER_NEXT_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN3_CODER_NEXT_API_MODEL_ID,
    name: AX_ENGINE_QWEN3_CODER_NEXT_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: true,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/Qwen3-Coder-Next-4bit",
        minDiskBytes: 64 * 1024 ** 3,
      },
      mlx6bit: {
        hfRepo: "mlx-community/Qwen3-Coder-Next-6bit",
        minDiskBytes: 96 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_QWEN36_35B_MODEL_ID]: {
    id: AX_ENGINE_QWEN36_35B_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN36_35B_API_MODEL_ID,
    name: AX_ENGINE_QWEN36_35B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: false,
    contextTokens: 65_536,
    outputTokens: 16_384,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/Qwen3.6-35B-A3B-4bit",
        minDiskBytes: 64 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GEMMA4_12B_MODEL_ID]: {
    id: AX_ENGINE_GEMMA4_12B_MODEL_ID,
    apiModelID: AX_ENGINE_GEMMA4_12B_API_MODEL_ID,
    name: AX_ENGINE_GEMMA4_12B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: false,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/gemma-4-12b-it-4bit",
        minDiskBytes: 32 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GEMMA4_26B_MODEL_ID]: {
    id: AX_ENGINE_GEMMA4_26B_MODEL_ID,
    apiModelID: AX_ENGINE_GEMMA4_26B_API_MODEL_ID,
    name: AX_ENGINE_GEMMA4_26B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: false,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/gemma-4-26b-a4b-it-4bit",
        minDiskBytes: 32 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GEMMA4_31B_MODEL_ID]: {
    id: AX_ENGINE_GEMMA4_31B_MODEL_ID,
    apiModelID: AX_ENGINE_GEMMA4_31B_API_MODEL_ID,
    name: AX_ENGINE_GEMMA4_31B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: false,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/gemma-4-31b-it-4bit",
        minDiskBytes: 64 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_QWEN36_27B_MODEL_ID]: {
    id: AX_ENGINE_QWEN36_27B_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN36_27B_API_MODEL_ID,
    name: AX_ENGINE_QWEN36_27B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: true,
    contextTokens: 65_536,
    outputTokens: 16_384,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/Qwen3.6-27B-4bit",
        minDiskBytes: 64 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_QWEN35_9B_MODEL_ID]: {
    id: AX_ENGINE_QWEN35_9B_MODEL_ID,
    apiModelID: AX_ENGINE_QWEN35_9B_API_MODEL_ID,
    name: AX_ENGINE_QWEN35_9B_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: true,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/Qwen3.5-9B-4bit",
        minDiskBytes: 32 * 1024 ** 3,
      },
    },
  },
  [AX_ENGINE_GLM47_MODEL_ID]: {
    id: AX_ENGINE_GLM47_MODEL_ID,
    apiModelID: AX_ENGINE_GLM47_API_MODEL_ID,
    name: AX_ENGINE_GLM47_MODEL_DISPLAY_NAME,
    defaultQuantization: "mlx4bit",
    toolcall: false,
    contextTokens: 32_768,
    outputTokens: 8_192,
    quantizations: {
      mlx4bit: {
        hfRepo: "mlx-community/GLM-4.7-4bit",
        minDiskBytes: 32 * 1024 ** 3,
      },
    },
  },
} as const

export const AX_ENGINE_DEFAULT_MODEL_ID: AxEngineModelID = AX_ENGINE_QWEN3_CODER_NEXT_MODEL_ID

export const AX_ENGINE_DEFAULT_QUANTIZATION: AxEngineQuantization = "mlx4bit"

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

export const AX_ENGINE_MIN_MACOS_MAJOR = 15
export const AX_ENGINE_MIN_MEMORY_BYTES = 64 * 1024 ** 3

export function isAxEngineModelID(value: unknown): value is AxEngineModelID {
  return typeof value === "string" && AX_ENGINE_MODEL_IDS.includes(value as AxEngineModelID)
}
