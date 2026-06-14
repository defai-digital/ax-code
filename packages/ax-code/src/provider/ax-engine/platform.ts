import os from "os"
import z from "zod"
import { Process } from "@/util/process"
import { toErrorMessage } from "@/util/error-message"
import { AX_ENGINE_ERROR, AX_ENGINE_MIN_MACOS_MAJOR, AX_ENGINE_WARN_MEMORY_BYTES } from "./constants"

export const AxEngineChipGeneration = z.enum(["unknown", "m1", "m2", "m3", "m4", "m5-or-newer"])
export type AxEngineChipGeneration = z.infer<typeof AxEngineChipGeneration>

export const AxEnginePlatformEligibility = z.object({
  supported: z.boolean(),
  platform: z.string(),
  arch: z.string(),
  macosVersion: z.string().optional(),
  macosMajor: z.number().optional(),
  chip: z.string().optional(),
  chipGeneration: AxEngineChipGeneration.default("unknown"),
  memoryBytes: z.number().optional(),
  blockers: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})
export type AxEnginePlatformEligibility = z.infer<typeof AxEnginePlatformEligibility>

export type AxEnginePlatformProbeInput = {
  platform?: string
  arch?: string
  macosVersion?: string
  chip?: string
  memoryBytes?: number
}

export function parseMacosMajor(version: string | undefined) {
  if (!version) return undefined
  const major = Number.parseInt(version.split(".")[0] ?? "", 10)
  return Number.isFinite(major) ? major : undefined
}

export function parseChipGeneration(chip: string | undefined): AxEngineChipGeneration {
  const normalized = (chip ?? "").toLowerCase()
  if (/\bm1\b/.test(normalized)) return "m1"
  if (/\bm2\b/.test(normalized)) return "m2"
  if (/\bm3\b/.test(normalized)) return "m3"
  if (/\bm4\b/.test(normalized)) return "m4"
  if (/\bm([5-9]|\d{2,})\b/.test(normalized)) return "m5-or-newer"
  return "unknown"
}

function chipSupported(generation: AxEngineChipGeneration) {
  return generation === "m2" || generation === "m3" || generation === "m4" || generation === "m5-or-newer"
}

export function evaluatePlatformEligibility(input: AxEnginePlatformProbeInput): AxEnginePlatformEligibility {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const macosMajor = parseMacosMajor(input.macosVersion)
  const chipGeneration = parseChipGeneration(input.chip)
  const blockers: string[] = []
  const warnings: string[] = []

  if (platform !== "darwin") blockers.push(`${AX_ENGINE_ERROR.UnsupportedPlatform}: ax-engine provider requires macOS`)
  if (arch !== "arm64") blockers.push(`${AX_ENGINE_ERROR.UnsupportedArch}: ax-engine provider requires arm64`)

  if (platform === "darwin") {
    if (macosMajor === undefined) {
      blockers.push(`${AX_ENGINE_ERROR.UnsupportedMacos}: unable to determine macOS version`)
    } else if (macosMajor < AX_ENGINE_MIN_MACOS_MAJOR) {
      blockers.push(`${AX_ENGINE_ERROR.UnsupportedMacos}: macOS ${AX_ENGINE_MIN_MACOS_MAJOR} or later is required`)
    }

    if (!chipSupported(chipGeneration)) {
      blockers.push(`${AX_ENGINE_ERROR.UnsupportedChip}: Apple Silicon M2 or later is required`)
    }
  }

  if (input.memoryBytes !== undefined && input.memoryBytes < AX_ENGINE_WARN_MEMORY_BYTES) {
    warnings.push(
      `${AX_ENGINE_ERROR.InsufficientMemory}: Qwen3-Coder-Next is large; 64 GB unified memory or more is recommended`,
    )
  }

  return {
    supported: blockers.length === 0,
    platform,
    arch,
    macosVersion: input.macosVersion,
    macosMajor,
    chip: input.chip,
    chipGeneration,
    memoryBytes: input.memoryBytes,
    blockers,
    warnings,
  }
}

async function probeText(cmd: string[]) {
  return Process.text(cmd, { timeout: 1500, nothrow: true })
    .then((out) => (out.code === 0 ? out.text.trim() : undefined))
    .catch(() => undefined)
}

export async function getPlatformEligibility(): Promise<AxEnginePlatformEligibility> {
  const platform = process.platform
  const arch = process.arch
  const [macosVersion, chip] =
    platform === "darwin"
      ? await Promise.all([
          probeText(["sw_vers", "-productVersion"]),
          probeText(["sysctl", "-n", "machdep.cpu.brand_string"]),
        ])
      : [undefined, undefined]

  try {
    return evaluatePlatformEligibility({
      platform,
      arch,
      macosVersion,
      chip,
      memoryBytes: os.totalmem(),
    })
  } catch (error) {
    return {
      supported: false,
      platform,
      arch,
      macosVersion,
      chip,
      chipGeneration: "unknown",
      memoryBytes: os.totalmem(),
      blockers: [`${AX_ENGINE_ERROR.UnsupportedPlatform}: ${toErrorMessage(error)}`],
      warnings: [],
    }
  }
}

export function isPlausiblySupportedHost() {
  return process.platform === "darwin" && process.arch === "arm64"
}
