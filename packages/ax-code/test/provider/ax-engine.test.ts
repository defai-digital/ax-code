import { afterEach, describe, expect, test } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { Provider } from "../../src/provider/provider"
import { ModelsDev } from "../../src/provider/models"
import { ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { getAxEngineDoctorCheck } from "../../src/cli/cmd/doctor"
import { shouldShowProviderInList } from "../../src/server/routes/provider"
import {
  AX_ENGINE_MODEL_ID,
  AX_ENGINE_PROVIDER_ID,
  axEngineLoader,
  evaluateDiskStatus,
  evaluatePlatformEligibility,
  markPrepared,
  normalizeQuantization,
  parseDfPkAvailableBytes,
  parseChipGeneration,
  parseMacosMajor,
  prepareAxEngine,
  resolveDownloadDestination,
} from "../../src/provider/ax-engine"

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Instance.disposeAll()
})

describe("ax-engine platform gate", () => {
  test("parses macOS versions and Apple Silicon generations", () => {
    expect(parseMacosMajor("26.0")).toBe(26)
    expect(parseMacosMajor("15.6.1")).toBe(15)
    expect(parseMacosMajor("not-a-version")).toBeUndefined()

    expect(parseChipGeneration("Apple M1 Max")).toBe("m1")
    expect(parseChipGeneration("Apple M2 Max")).toBe("m2")
    expect(parseChipGeneration("Apple M4 Pro")).toBe("m4")
    expect(parseChipGeneration("Apple M5 Max")).toBe("m5-or-newer")
    expect(parseChipGeneration("Intel")).toBe("unknown")
  })

  test("blocks unsupported host shapes before download or server work", () => {
    expect(
      evaluatePlatformEligibility({
        platform: "linux",
        arch: "x64",
        memoryBytes: 16 * 1024 ** 3,
      }),
    ).toMatchObject({
      supported: false,
      blockers: expect.arrayContaining([
        expect.stringContaining("AX_ENGINE_UNSUPPORTED_PLATFORM"),
        expect.stringContaining("AX_ENGINE_UNSUPPORTED_ARCH"),
      ]),
    })

    expect(
      evaluatePlatformEligibility({
        platform: "darwin",
        arch: "arm64",
        macosVersion: "25.0",
        chip: "Apple M1 Max",
      }),
    ).toMatchObject({
      supported: false,
      blockers: expect.arrayContaining([
        expect.stringContaining("AX_ENGINE_UNSUPPORTED_MACOS"),
        expect.stringContaining("AX_ENGINE_UNSUPPORTED_CHIP"),
      ]),
    })

    expect(
      evaluatePlatformEligibility({
        platform: "darwin",
        arch: "arm64",
        macosVersion: "26.0",
        chip: "Apple M2 Max",
        memoryBytes: 32 * 1024 ** 3,
      }),
    ).toMatchObject({
      supported: false,
      blockers: expect.arrayContaining([expect.stringContaining("AX_ENGINE_INSUFFICIENT_MEMORY")]),
    })

    expect(
      evaluatePlatformEligibility({
        platform: "darwin",
        arch: "arm64",
        macosVersion: "26.0",
        chip: "Apple M2 Max",
        memoryBytes: 64 * 1024 ** 3,
      }),
    ).toMatchObject({
      supported: true,
      blockers: [],
    })
  })
})

describe("ax-engine model cache", () => {
  test("normalizes unknown quantization to the conservative default", () => {
    expect(normalizeQuantization("mlx6bit")).toBe("mlx6bit")
    expect(normalizeQuantization("surprise")).toBe("mlx4bit")
  })

  test("defaults downloads into the deterministic AX Code managed model cache", () => {
    expect(resolveDownloadDestination("mlx4bit")).toContain("ax-engine/models/qwen3-coder-next/mlx4bit")
    expect(resolveDownloadDestination("mlx6bit")).toContain("ax-engine/models/qwen3-coder-next/mlx6bit")
    expect(resolveDownloadDestination("mlx4bit", "/Volumes/Models/qwen")).toBe("/Volumes/Models/qwen")
  })

  test("parses POSIX df output and blocks downloads without enough free space", () => {
    expect(
      parseDfPkAvailableBytes(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s5 994662584 650000000 344662584 66% /System/Volumes/Data
`),
    ).toBe(344662584 * 1024)

    expect(
      evaluateDiskStatus({
        path: "/tmp/ax-engine",
        quantization: "mlx4bit",
        freeBytes: 16 * 1024 ** 3,
      }),
    ).toMatchObject({
      ok: false,
      blockers: expect.arrayContaining([expect.stringContaining("AX_ENGINE_INSUFFICIENT_DISK")]),
    })

    expect(
      evaluateDiskStatus({
        path: "/tmp/ax-engine",
        quantization: "mlx4bit",
        freeBytes: 80 * 1024 ** 3,
      }),
    ).toMatchObject({
      ok: true,
      blockers: [],
    })
  })

  test("refuses to mark a missing or manifest-less model path prepared", async () => {
    await using tmp = await tmpdir()
    await expect(markPrepared({ modelPath: path.join(tmp.path, "missing") })).rejects.toThrow(
      "model path does not exist",
    )
    await expect(markPrepared({ modelPath: tmp.path })).rejects.toThrow("model-manifest.json")
  })
})

describe("ax-engine prepare lifecycle", () => {
  const eligibility = {
    supported: true,
    platform: "darwin",
    arch: "arm64",
    macosVersion: "26.0",
    macosMajor: 26,
    chip: "Apple M2 Max",
    chipGeneration: "m2",
    memoryBytes: 64 * 1024 ** 3,
    blockers: [],
    warnings: [],
  } as any

  test("checks prepared model status without starting server unless requested", async () => {
    const calls: string[] = []
    const result = await prepareAxEngine(
      { quantization: "mlx4bit" },
      {
        requireEligibility: async () => eligibility,
        getModelStatus: async () => {
          calls.push("model")
          return {
            present: false,
            modelID: AX_ENGINE_MODEL_ID,
            quantization: "mlx4bit",
            complete: false,
            blockers: ["AX_ENGINE_MODEL_MISSING: missing"],
          }
        },
        ensureServer: async () => {
          throw new Error("should not start")
        },
      },
    )

    expect(calls).toEqual(["model"])
    expect(result.model.present).toBe(false)
    expect(result.server).toBeUndefined()
  })

  test("can start an already prepared model through the shared lifecycle helper", async () => {
    const calls: string[] = []
    const result = await prepareAxEngine(
      { quantization: "mlx4bit", start: true },
      {
        requireEligibility: async () => eligibility,
        getModelStatus: async () => {
          calls.push("model")
          return {
            present: true,
            modelID: AX_ENGINE_MODEL_ID,
            quantization: "mlx4bit",
            path: "/models/qwen",
            revision: "abc123",
            complete: true,
            blockers: [],
          }
        },
        getDependencyStatus: async () => {
          calls.push("dependency")
          return {
            available: true,
            mode: "configured",
            binaryPath: "/bin/ax-engine",
            blockers: [],
          }
        },
        ensureServer: async (input) => {
          calls.push("server")
          expect(input.modelPath).toBe("/models/qwen")
          expect(input.modelRevision).toBe("abc123")
          return {
            pid: 123,
            port: 18181,
            baseURL: "http://127.0.0.1:18181/v1",
            modelID: AX_ENGINE_MODEL_ID,
            modelPath: input.modelPath,
            modelRevision: input.modelRevision,
            binaryPath: input.binaryPath,
            startedAt: 1,
            lastHealthAt: 2,
          }
        },
      },
    )

    expect(calls).toEqual(["model", "dependency", "server"])
    expect(result.server?.baseURL).toBe("http://127.0.0.1:18181/v1")
  })

  test("download prepare reuses the resolved dependency when starting", async () => {
    const calls: string[] = []
    const result = await prepareAxEngine(
      { quantization: "mlx4bit", download: true, start: true },
      {
        requireEligibility: async () => eligibility,
        getDependencyStatus: async () => {
          calls.push("dependency")
          return {
            available: true,
            mode: "configured",
            binaryPath: "/bin/ax-engine",
            blockers: [],
          }
        },
        downloadModel: async (input) => {
          calls.push("download")
          expect(input.binaryPath).toBe("/bin/ax-engine")
          return {
            modelID: AX_ENGINE_MODEL_ID,
            quantization: "mlx4bit",
            path: "/models/qwen",
            revision: "def456",
            preparedAt: 1,
          }
        },
        ensureServer: async () => {
          calls.push("server")
          return {
            pid: 123,
            port: 18181,
            baseURL: "http://127.0.0.1:18181/v1",
            modelID: AX_ENGINE_MODEL_ID,
            modelPath: "/models/qwen",
            modelRevision: "def456",
            binaryPath: "/bin/ax-engine",
            startedAt: 1,
          }
        },
      },
    )

    expect(calls).toEqual(["dependency", "download", "server"])
    expect(result.prepared?.path).toBe("/models/qwen")
    expect(result.server?.modelRevision).toBe("def456")
  })
})

describe("ax-engine provider integration", () => {
  test("built-in models declare only Qwen3-Coder-Next as an experimental local model", async () => {
    const provider = (await ModelsDev.get())[AX_ENGINE_PROVIDER_ID]
    expect(provider).toBeDefined()
    expect(Object.keys(provider.models)).toEqual([AX_ENGINE_MODEL_ID])
    expect(provider.models[AX_ENGINE_MODEL_ID]).toMatchObject({
      tool_call: false,
      status: "beta",
      experimental: { localRuntime: "ax-engine" },
    })
  })

  test("configured provider is available without starting ax-engine during provider list", async () => {
    await using tmp = await tmpdir({
      config: {
        provider: {
          [AX_ENGINE_PROVIDER_ID]: {
            options: {
              modelPath: "/tmp/not-used-during-list",
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const axEngine = providers[ProviderID.make(AX_ENGINE_PROVIDER_ID)]
        expect(axEngine).toBeDefined()
        expect(axEngine.models[AX_ENGINE_MODEL_ID]).toBeDefined()
        expect(axEngine.options.baseURL).toBe("http://127.0.0.1:18181/v1")
      },
    })
  })

  test("healthy configured local endpoint bypasses managed model and binary gates", async () => {
    const seen: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      seen.push(url)
      if (url === "http://127.0.0.1:18181/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: AX_ENGINE_MODEL_ID }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (url === "http://127.0.0.1:18181/v1/chat/completions") {
        return new Response("{}", { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const loader = await axEngineLoader()({
      id: AX_ENGINE_PROVIDER_ID,
      name: "AX Engine",
      source: "config",
      env: [],
      options: { baseURL: "http://127.0.0.1:18181/v1" },
      models: {},
    } as any)

    const res = await loader.options!.fetch("http://127.0.0.1:18181/v1/chat/completions")
    expect(res.status).toBe(200)
    expect(seen).toEqual(["http://127.0.0.1:18181/v1/models", "http://127.0.0.1:18181/v1/chat/completions"])
  })

  test("provider list exposes ax-engine only after full host eligibility passes", () => {
    expect(
      shouldShowProviderInList({
        key: AX_ENGINE_PROVIDER_ID,
        disabled: new Set(),
        axEngineSupported: false,
      }),
    ).toBe(false)
    expect(
      shouldShowProviderInList({
        key: AX_ENGINE_PROVIDER_ID,
        disabled: new Set(),
        enabled: new Set([AX_ENGINE_PROVIDER_ID]),
        axEngineSupported: false,
      }),
    ).toBe(false)
    expect(
      shouldShowProviderInList({
        key: AX_ENGINE_PROVIDER_ID,
        disabled: new Set(),
        axEngineSupported: true,
      }),
    ).toBe(true)
  })

  test("core provider list also gates ax-engine even when explicitly enabled", () => {
    expect(
      Provider.shouldAllowProviderInCore({
        providerID: AX_ENGINE_PROVIDER_ID,
        disabled: new Set(),
        enabled: new Set([AX_ENGINE_PROVIDER_ID]),
        axEngineSupported: false,
      }),
    ).toBe(false)

    expect(
      Provider.shouldAllowProviderInCore({
        providerID: AX_ENGINE_PROVIDER_ID,
        disabled: new Set(),
        enabled: new Set([AX_ENGINE_PROVIDER_ID]),
        axEngineSupported: true,
      }),
    ).toBe(true)

    expect(
      Provider.shouldAllowProviderInCore({
        providerID: "xai",
        disabled: new Set(),
        enabled: new Set(["xai"]),
        axEngineSupported: false,
      }),
    ).toBe(true)
  })
})

describe("ax-engine doctor status", () => {
  test("reports disk blockers before model preparation when dependency is available", () => {
    const check = getAxEngineDoctorCheck({
      eligibility: { supported: true, blockers: [], warnings: [] },
      dependency: { available: true, binaryPath: "/bin/ax-engine", blockers: [] },
      disk: { ok: false, blockers: ["AX_ENGINE_INSUFFICIENT_DISK: 64 GiB free is required"] },
      model: { present: false, blockers: ["AX_ENGINE_MODEL_MISSING: missing"] },
      server: { running: false, ready: false, blockers: [] },
      capability: { toolcall: false, attachment: false },
    } as any)

    expect(check.name).toBe("AX Engine local provider")
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("AX_ENGINE_INSUFFICIENT_DISK")
  })

  test("reports missing model after eligibility and dependency pass", () => {
    const check = getAxEngineDoctorCheck({
      eligibility: { supported: true, blockers: [], warnings: [] },
      dependency: { available: true, binaryPath: "/bin/ax-engine", blockers: [] },
      disk: { ok: true, blockers: [] },
      model: { present: false, blockers: ["AX_ENGINE_MODEL_MISSING: missing"] },
      server: { running: false, ready: false, blockers: [] },
      capability: { toolcall: false, attachment: false },
    } as any)

    expect(check.name).toBe("AX Engine local provider")
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("not prepared")
  })
})
