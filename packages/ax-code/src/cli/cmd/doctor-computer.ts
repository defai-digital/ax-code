import { CuaProvider, OcuProvider, probeProvider } from "@ax-code/computer"
import type { ComputerUseProvider, ProbeReport } from "@ax-code/computer"
import { Computer } from "@/computer/computer"
import type { Config } from "@/config/config"
import { toErrorMessage } from "@/util/error-message"
import type { DoctorCheck } from "./doctor-health"

const INSTALL_HINTS = { cua: "cua-driver", ocu: "open-computer-use" } as const

/**
 * Computer-use preflight: when `computer.provider` is configured, spawn the
 * resolved backend and run a real MCP handshake + list_apps probe. Everything
 * is injectable so unit tests never spawn a process.
 */
export async function getComputerUseCheck(
  input: {
    config?: Config.Info["computer"]
    platform?: NodeJS.Platform
    probe?: (provider: ComputerUseProvider) => Promise<ProbeReport>
  } = {},
): Promise<DoctorCheck> {
  const name = "Computer use"
  const resolved = Computer.resolveBackend(input.config)
  if (!resolved) {
    return { name, status: "ok", detail: "not configured (set computer.provider to enable desktop control)" }
  }

  const platform = input.platform ?? process.platform
  if (resolved.provider === "ocu" && platform !== "darwin") {
    return { name, status: "warn", detail: "OCU is macOS-only; use provider cua on this platform" }
  }

  const command = `${resolved.command} ${resolved.args.join(" ")}`
  const probe = input.probe ?? probeProvider

  try {
    const options = { command: resolved.command, args: resolved.args }
    const provider = resolved.provider === "ocu" ? new OcuProvider(options) : new CuaProvider(options)
    const report = await probe(provider)
    if (report.ok) {
      let detail = `provider ${resolved.provider} via ${command} — handshake ok in ${report.latencyMs}ms, ${report.apps ?? 0} apps visible`
      if (platform === "darwin") {
        detail += " — Accessibility/Screen Recording prompts attach to the host process"
      }
      return { name, status: "ok", detail }
    }
    return {
      name,
      status: "fail",
      detail:
        `provider ${resolved.provider} unavailable via "${command}" (override with ${resolved.env} or computer.command). ` +
        `Install ${INSTALL_HINTS[resolved.provider]} and retry. ${report.error ?? "unknown error"}`,
    }
  } catch (error) {
    // doctor must never crash on a preflight
    return { name, status: "warn", detail: `Could not run computer-use preflight: ${toErrorMessage(error)}` }
  }
}
