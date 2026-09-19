import { afterEach, expect, test, vi } from "vitest"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { getAxEngineStatus, prepareAxEngine } from "../../src/provider/ax-engine"
import { ProvidersAxEngineCommand } from "../../src/cli/cmd/providers"

vi.mock("../../src/provider/ax-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/provider/ax-engine")>()
  return { ...actual, prepareAxEngine: vi.fn(async () => ({})), getAxEngineStatus: vi.fn(async () => ({})) }
})

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test.each(["status", "prepare", "start"])(
  "%s preserves configured options and honors explicit CLI overrides",
  async (action) => {
    const configured = {
      modelID: "qwen3.8-27b-axq-6bit",
      quantization: "mlx6bit",
      binaryPath: "/configured/ax-engine",
      modelPath: "/configured/model",
      mtpPolicy: "required",
    }
    vi.spyOn(Config, "get").mockResolvedValue({ provider: { "ax-engine": { options: configured } } })
    vi.spyOn(Provider, "invalidate").mockResolvedValue()
    vi.spyOn(console, "log").mockImplementation(() => {})
    const call = action === "status" ? getAxEngineStatus : prepareAxEngine
    await ProvidersAxEngineCommand.handler({ action, json: true } as any)
    expect(call).toHaveBeenLastCalledWith(expect.objectContaining(configured))
    await ProvidersAxEngineCommand.handler({
      action,
      json: true,
      binaryPath: "/override/ax-engine",
      modelPath: "/override/model",
      mtpPolicy: "auto",
    } as any)
    expect(call).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ...configured,
        binaryPath: "/override/ax-engine",
        modelPath: "/override/model",
        mtpPolicy: "auto",
      }),
    )
  },
)
