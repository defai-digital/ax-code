import { describe, expect, test } from "vitest"
import {
  AX_CODE_LOCAL_ENGINE_BACKEND,
  AX_ENGINE_ERROR,
  LOCAL_ENGINE_PHASE_RANK,
  mapAxEngineStatusToLifecycle,
  type AxEngineStatus,
} from "../../../src/provider/ax-engine"

function baseStatus(over: Partial<AxEngineStatus> = {}): AxEngineStatus {
  return {
    eligibility: {
      supported: true,
      platform: "darwin",
      arch: "arm64",
      chipGeneration: "m4",
      blockers: [],
      warnings: [],
    },
    dependency: {
      available: true,
      mode: "path",
      binaryPath: "/usr/local/bin/ax-engine",
      installable: false,
      blockers: [],
    },
    disk: {
      path: "/tmp",
      modelID: "qwen3.6-27b-6bit",
      quantization: "mlx6bit",
      requiredBytes: 1,
      ok: true,
      blockers: [],
    },
    model: {
      present: true,
      modelID: "qwen3.6-27b-6bit",
      quantization: "mlx6bit",
      complete: true,
      blockers: [],
    },
    server: {
      running: true,
      ready: true,
      blockers: [],
    },
    capability: {
      toolcall: true,
      attachment: false,
    },
    ...over,
  }
}

describe("mapAxEngineStatusToLifecycle", () => {
  test("defaults to sidecar_http backend", () => {
    const lifecycle = mapAxEngineStatusToLifecycle(baseStatus())
    expect(lifecycle.backend).toBe(AX_CODE_LOCAL_ENGINE_BACKEND)
    expect(lifecycle.backend).toBe("sidecar_http")
    expect(lifecycle.phase).toBe("ready")
  })

  test("maps unsupported host to unavailable", () => {
    const lifecycle = mapAxEngineStatusToLifecycle(
      baseStatus({
        eligibility: {
          supported: false,
          platform: "linux",
          arch: "x64",
          chipGeneration: "unknown",
          blockers: [AX_ENGINE_ERROR.UnsupportedPlatform],
          warnings: [],
        },
      }),
    )
    expect(lifecycle.phase).toBe("unavailable")
  })

  test("maps missing binary to missing_dependency", () => {
    const lifecycle = mapAxEngineStatusToLifecycle(
      baseStatus({
        dependency: {
          available: false,
          mode: "missing",
          installable: true,
          blockers: [AX_ENGINE_ERROR.BinaryMissing],
        },
        server: { running: false, ready: false, blockers: [] },
      }),
    )
    expect(lifecycle.phase).toBe("missing_dependency")
  })

  test("maps unprepared model to missing_model", () => {
    const lifecycle = mapAxEngineStatusToLifecycle(
      baseStatus({
        model: {
          present: false,
          modelID: "qwen3.6-27b-6bit",
          quantization: "mlx6bit",
          complete: false,
          blockers: [AX_ENGINE_ERROR.ModelNotPrepared],
        },
        server: { running: false, ready: false, blockers: [] },
      }),
    )
    expect(lifecycle.phase).toBe("missing_model")
  })

  test("maps running-but-not-ready server to starting", () => {
    const lifecycle = mapAxEngineStatusToLifecycle(
      baseStatus({
        server: {
          running: true,
          ready: false,
          blockers: [AX_ENGINE_ERROR.ServerHealthFailed],
        },
      }),
    )
    expect(lifecycle.phase).toBe("starting")
  })

  test("maps ready without toolcall to degraded", () => {
    const lifecycle = mapAxEngineStatusToLifecycle(
      baseStatus({
        capability: {
          toolcall: false,
          attachment: false,
          reason: `${AX_ENGINE_ERROR.ToolcallUnsupported}: no tools`,
        },
      }),
    )
    expect(lifecycle.phase).toBe("degraded")
    expect(lifecycle.blockers.some((b) => b.includes(AX_ENGINE_ERROR.ToolcallUnsupported))).toBe(true)
  })

  test("prefers error over missing_model when start failed", () => {
    const lifecycle = mapAxEngineStatusToLifecycle(
      baseStatus({
        model: {
          present: false,
          modelID: "qwen3.6-27b-6bit",
          quantization: "mlx6bit",
          complete: false,
          blockers: [AX_ENGINE_ERROR.ModelNotPrepared],
        },
        server: {
          running: false,
          ready: false,
          blockers: [`${AX_ENGINE_ERROR.ServerStartFailed}: boom`],
        },
      }),
    )
    expect(LOCAL_ENGINE_PHASE_RANK.error).toBeGreaterThan(LOCAL_ENGINE_PHASE_RANK.missing_model)
    expect(lifecycle.phase).toBe("error")
  })
})
