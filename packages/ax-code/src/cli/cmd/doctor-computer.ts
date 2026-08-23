import fs from "node:fs"
import { ExternalComputerProvider, probeProvider } from "@ax-code/computer"
import type { ComputerUseProvider, ProbeReport } from "@ax-code/computer"
import { Computer } from "@/computer/computer"
import type { Config } from "@/config/config"
import { toErrorMessage } from "@/util/error-message"
import type { DoctorCheck } from "./doctor-health"

const INSTALL_HINT = "the ax-computer server (canonical AX Computer protocol)"

/**
 * Computer-use preflight: when `computer.provider` is configured, resolve the
 * ax-computer server command and run a real MCP handshake + protocol
 * negotiation + list_apps probe through ExternalComputerProvider. Everything
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
  let resolved: Computer.ResolvedBackend | undefined
  try {
    // an unresolvable server command is a preflight failure with the
    // resolver's install hint, never a crash
    resolved = Computer.resolveBackend(input.config)
  } catch (error) {
    return { name, status: "fail", detail: toErrorMessage(error) }
  }
  if (!resolved) {
    return { name, status: "ok", detail: "not configured (set computer.provider to enable desktop control)" }
  }

  const platform = input.platform ?? process.platform
  if (resolved.provider === "axnative" && platform !== "darwin") {
    return {
      name,
      status: "warn",
      detail: 'the axnative backend is macOS-only; use provider "cua" (or "external") on this platform',
    }
  }

  const command = `${resolved.command} ${resolved.args.join(" ")}`.trim()

  // resolved commands can be explicit paths; fail fast when such a path is
  // missing instead of surfacing an opaque spawn ENOENT from the probe
  if (resolved.command.includes("/") && !fs.existsSync(resolved.command)) {
    return {
      name,
      status: "fail",
      detail:
        `provider ${resolved.provider} command missing at "${resolved.command}". ` +
        `Install ${INSTALL_HINT} or point computer.command / AX_COMPUTER_COMMAND at it.`,
    }
  }

  const probe = input.probe ?? probeProvider

  try {
    const provider = new ExternalComputerProvider({ command: resolved.command, args: resolved.args })
    // the probe's first call performs protocol version negotiation; an
    // incompatible server fails here with the mismatch detail
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
        `provider ${resolved.provider} unavailable via "${command}" (override with AX_COMPUTER_COMMAND or computer.command). ` +
        `Install ${INSTALL_HINT} and retry. ${report.error ?? "unknown error"}`,
    }
  } catch (error) {
    // doctor must never crash on a preflight
    return { name, status: "warn", detail: `Could not run computer-use preflight: ${toErrorMessage(error)}` }
  }
}
