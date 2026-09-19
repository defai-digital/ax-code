import { afterEach, expect, test, vi } from "vitest"
import {
  axEngineMtpLaunchArgs,
  observeAxEngineMtp,
  parseAxEngineMtpMetrics,
  resolveAxEngineMtpPolicy,
} from "../../../src/provider/ax-engine/mtp"
import { axEngineServerLaunchArgs, ensureServer } from "../../../src/provider/ax-engine/server"
import { Process } from "../../../src/util/process"
import { FileLock } from "../../../src/util/filelock"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test("MTP defaults to required; explicit policies still override the default", () => {
  vi.stubEnv("AX_ENGINE_MTP_POLICY", undefined)
  expect(resolveAxEngineMtpPolicy()).toBe("required")
  vi.stubEnv("AX_ENGINE_MTP_POLICY", "disabled")
  expect(resolveAxEngineMtpPolicy()).toBe("disabled")
  expect(resolveAxEngineMtpPolicy({ mtpPolicy: "required" })).toBe("required")
  vi.stubEnv("AX_ENGINE_MTP_POLICY", "required")
  expect(resolveAxEngineMtpPolicy()).toBe("required")
  expect(resolveAxEngineMtpPolicy({ mtpPolicy: "disabled" })).toBe("disabled")
  expect(resolveAxEngineMtpPolicy({ mtpPolicy: "auto" })).toBe("auto")
  for (const mtpPolicy of ["pure", "on", "", false, 1]) {
    expect(() => resolveAxEngineMtpPolicy({ mtpPolicy })).toThrow("disabled, auto, or required")
  }
})

test("qualified launches without an explicit policy require MTP", () => {
  const args = axEngineServerLaunchArgs({ apiModelID: "qwen3.8-27b-axq-6bit", binaryVersion: "7.4.0" })
  expect(args[args.indexOf("--mlx-mtp-policy") + 1]).toBe("required")
})

test.each(["disabled", "auto", "required"] as const)(
  "%s reaches the explicit engine policy without auto-disable",
  (mtpPolicy) => {
    const args = axEngineServerLaunchArgs({ apiModelID: "qwen3.8-27b-axq-6bit", binaryVersion: "7.4.0", mtpPolicy })
    const policy = args[args.indexOf("--mlx-mtp-policy") + 1]
    // Mirror the actual engine CLI contract that caused the incident.
    const effective = args.includes("--disable-ngram-acceleration") && policy === "auto" ? "disabled" : policy
    expect(effective).toBe(mtpPolicy)
    expect(args).toContain("--mlx-mtp-disable-ngram-stacking")
  },
)

test.each([undefined, "unknown", "7.3.0"])("unqualified binary %s cannot silently downgrade opt-in", (version) => {
  expect(axEngineMtpLaunchArgs(undefined, version)).toEqual(["--disable-ngram-acceleration"])
  expect(() => axEngineMtpLaunchArgs("disabled", version)).toThrow("7.4.0")
  expect(() => axEngineMtpLaunchArgs("auto", version)).toThrow("7.4.0")
  expect(() => axEngineMtpLaunchArgs("required", version)).toThrow("7.4.0")
})

test("unsupported opt-in fails before the lifecycle lock or process inspection", async () => {
  const lock = vi.spyOn(FileLock, "acquire")
  const inspect = vi.spyOn(Process, "text")
  await expect(
    ensureServer({
      binaryPath: "/unused/ax-engine",
      modelID: "qwen3.8-27b-axq-6bit",
      apiModelID: "qwen3.8-27b-axq-6bit",
      modelPath: "/unused/model",
      binaryVersion: "7.3.0",
      mtpPolicy: "required",
    }),
  ).rejects.toThrow("7.4.0")
  expect(lock).not.toHaveBeenCalled()
  expect(inspect).not.toHaveBeenCalled()
})

test("runtime activation comes from the exact model's latest route, not capabilities or aggregate counters", () => {
  const text = [
    "ax_engine_mlx_mtp_certified_default_on 1",
    "ax_engine_mlx_mtp_runtime_enabled_by_default 1",
    "ax_engine_mlx_mtp_model_policy_active 1",
    'ax_engine_mlx_mtp_model_policy_active{model="qwen"} 0',
    'ax_engine_mlx_mtp_model_policy_active{model="other"} 1',
    'ax_engine_mtp_draft_tokens_total{model="qwen"} 12',
    'ax_engine_mtp_accepted_tokens_total{model="qwen"} 8',
  ].join("\n")
  expect(parseAxEngineMtpMetrics(text, "qwen")).toEqual({ effective: "inactive", draftedTokens: 12, acceptedTokens: 8 })
  expect(parseAxEngineMtpMetrics(text, "absent").effective).toBe("unknown")
  expect(parseAxEngineMtpMetrics("ax_engine_mlx_mtp_runtime_enabled_by_default 1", "qwen").effective).toBe("unknown")
  expect(parseAxEngineMtpMetrics("ax_engine_mlx_mtp_model_policy_active NaN", "qwen").effective).toBe("unknown")
  expect(parseAxEngineMtpMetrics("ax_engine_mlx_mtp_model_policy_active 1", "qwen").effective).toBe("unknown")
})

test.each(["0", "1"])("aggregate %s without an observed model cannot establish MTP activation", (value) => {
  // A legacy aggregate cannot establish whether this model was observed.
  expect(
    parseAxEngineMtpMetrics(
      `ax_engine_mlx_mtp_model_policy_active ${value}\nax_engine_mtp_draft_tokens_total 0`,
      "qwen",
    ),
  ).toEqual({ effective: "unknown", draftedTokens: undefined, acceptedTokens: undefined })
})

test.each(["NaN", "-1", "+Inf"])("invalid exact-model sample %s cannot fall back to the aggregate", (value) => {
  expect(
    parseAxEngineMtpMetrics(
      `ax_engine_mlx_mtp_model_policy_active 1\nax_engine_mlx_mtp_model_policy_active{model="qwen"} ${value}`,
      "qwen",
    ).effective,
  ).toBe("unknown")
})

test("status distinguishes requested, launched, and observed policy without changing the server", async () => {
  const fetch = vi.fn(async () => new Response('ax_engine_mlx_mtp_model_policy_active{model="api-id"} 0\n'))
  vi.stubGlobal("fetch", fetch)
  const status = await observeAxEngineMtp({
    requestedPolicy: "required",
    state: { mtpPolicy: "disabled", baseURL: "http://127.0.0.1:31418/v1", modelID: "alias", apiModelID: "api-id" },
    ready: true,
    apiKey: "test-key",
  })
  expect(status).toMatchObject({
    requestedPolicy: "required",
    launchedPolicy: "disabled",
    effective: "inactive",
    pendingRestart: true,
  })
  expect(fetch.mock.calls).toHaveLength(1)
  expect(vi.mocked(globalThis.fetch).mock.calls[0][0].toString()).toBe("http://127.0.0.1:31418/metrics")
  expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { authorization: "Bearer test-key" },
  })
})

test.each(["unavailable", "failed", "empty"])(
  "%s telemetry is unknown, never inferred from required policy",
  async (kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (kind === "failed") throw new Error("offline")
        return new Response("", { status: kind === "unavailable" ? 404 : 200 })
      }),
    )
    expect(
      await observeAxEngineMtp({
        requestedPolicy: "required",
        state: { mtpPolicy: "required", baseURL: "http://127.0.0.1:31418/v1", modelID: "qwen" },
        ready: true,
        apiKey: "test-key",
      }),
    ).toMatchObject({ launchedPolicy: "required", effective: "unknown", pendingRestart: false })
  },
)

test("legacy state reports unknown policy without treating pure stacking as activation", async () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  expect(
    await observeAxEngineMtp({
      requestedPolicy: "disabled",
      state: { baseURL: "http://127.0.0.1:31418/v1", modelID: "qwen" },
      ready: false,
      apiKey: "test-key",
    }),
  ).toMatchObject({
    requestedPolicy: "disabled",
    launchedPolicy: undefined,
    effective: "unknown",
    pendingRestart: true,
  })
  expect(fetch).not.toHaveBeenCalled()
})
