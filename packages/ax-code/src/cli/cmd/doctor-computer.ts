import fs from "node:fs"
import { AXNativeProvider, CuaProvider, ExternalComputerProvider, probeProvider } from "@ax-code/computer"
import type { ComputerUseProvider, ProbeReport } from "@ax-code/computer"
import { Computer } from "@/computer/computer"
import type { Config } from "@/config/config"
import { toErrorMessage } from "@/util/error-message"
import type { DoctorCheck } from "./doctor-health"

const INSTALL_HINTS = {
  cua: "cua-driver",
  axnative: "ax-computer-driver (build with `pnpm --dir packages/ax-computer run build:native`)",
  external: "an MCP server speaking the canonical AX Computer protocol",
} as const

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
  let resolved: Computer.ResolvedBackend | undefined
  try {
    // misconfiguration (e.g. external without an explicit command) is a
    // preflight failure with the resolver's message, never a crash
    resolved = Computer.resolveBackend(input.config)
  } catch (error) {
    return { name, status: "fail", detail: toErrorMessage(error) }
  }
  if (!resolved) {
    return { name, status: "ok", detail: "not configured (set computer.provider to enable desktop control)" }
  }

  const platform = input.platform ?? process.platform
  if (resolved.provider === "axnative" && platform !== "darwin") {
    return { name, status: "warn", detail: "ax-computer-driver is macOS-only; use provider cua on this platform" }
  }

  const command = `${resolved.command} ${resolved.args.join(" ")}`.trim()

  // axnative's legacy direct path resolves to a built binary path when one
  // exists; fail fast with a build hint when a configured/env path points at
  // a missing binary instead of waiting for the spawn to fail in the probe.
  if (
    resolved.via === "direct" &&
    resolved.provider === "axnative" &&
    resolved.command.includes("/") &&
    !fs.existsSync(resolved.command)
  ) {
    return {
      name,
      status: "fail",
      detail:
        `provider axnative binary missing at "${resolved.command}". ` +
        `Build it with \`pnpm --dir packages/ax-computer run build:native\` or override with ${resolved.env} / computer.command.`,
    }
  }

  // bridge commands (the ax-computer server for remapped aliases, or the
  // user-supplied external command) are executable paths; fail fast when the
  // path is missing instead of surfacing an opaque spawn ENOENT from the probe
  if (resolved.via === "bridge" && resolved.command.includes("/") && !fs.existsSync(resolved.command)) {
    return {
      name,
      status: "fail",
      detail:
        `provider ${resolved.provider} command missing at "${resolved.command}". ` +
        `Install the ax-computer server (canonical AX Computer protocol) or point computer.command / ${resolved.env} at it.`,
    }
  }

  const probe = input.probe ?? probeProvider

  try {
    const options = { command: resolved.command, args: resolved.args }
    const provider =
      resolved.via === "bridge"
        ? new ExternalComputerProvider(options)
        : resolved.provider === "cua"
          ? new CuaProvider(options)
          : new AXNativeProvider(options)
    // on the bridge path, the probe's first call performs protocol version
    // negotiation; an incompatible server fails here with the mismatch detail
    const report = await probe(provider)
    if (report.ok) {
      let detail = `provider ${resolved.provider} via ${command} — handshake ok in ${report.latencyMs}ms, ${report.apps ?? 0} apps visible`
      if (platform === "darwin") {
        detail += " — Accessibility/Screen Recording prompts attach to the host process"
      }
      // a working legacy override is still deprecated: warn, don't fail
      if (resolved.legacyOverride) {
        return {
          name,
          status: "warn",
          detail:
            detail +
            ` — DEPRECATED: the direct-driver override (${resolved.env} / computer.command) will be removed in a future major release; unset it and install the ax-computer server to route through the canonical protocol`,
        }
      }
      return { name, status: "ok", detail }
    }
    const hint =
      resolved.via === "bridge"
        ? resolved.provider === "external"
          ? INSTALL_HINTS.external
          : "the ax-computer server (canonical AX Computer protocol)"
        : (INSTALL_HINTS[resolved.provider as keyof typeof INSTALL_HINTS] ?? resolved.provider)
    return {
      name,
      status: "fail",
      detail:
        `provider ${resolved.provider} unavailable via "${command}" (override with ${resolved.env} or computer.command). ` +
        `Install ${hint} and retry. ${report.error ?? "unknown error"}`,
    }
  } catch (error) {
    // doctor must never crash on a preflight
    return { name, status: "warn", detail: `Could not run computer-use preflight: ${toErrorMessage(error)}` }
  }
}
