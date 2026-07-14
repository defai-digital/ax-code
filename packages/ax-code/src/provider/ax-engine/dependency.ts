import fs from "fs/promises"
import { constants } from "fs"
import z from "zod"
import semver from "semver"
import { which } from "@/util/which"
import { Process } from "@/util/process"
import { AX_ENGINE_ERROR, AX_ENGINE_MIN_VERSION } from "./constants"
import { getManagedBinary, isAxEngineInstallable } from "./install"
import { parseJsonResult } from "@/util/json-value"

export const AxEngineDependencyStatus = z.object({
  available: z.boolean(),
  mode: z.enum(["configured", "path", "managed", "missing"]),
  binaryPath: z.string().optional(),
  version: z.string().optional(),
  // Version of the AX Code-managed binary, when `mode` is "managed".
  managedVersion: z.string().optional(),
  // When missing, whether AX Code can download + install the binary on this host.
  installable: z.boolean().default(false),
  blockers: z.array(z.string()).default([]),
})
export type AxEngineDependencyStatus = z.infer<typeof AxEngineDependencyStatus>

export type AxEngineDependencyOptions = {
  binaryPath?: unknown
  [key: string]: unknown
}

async function isExecutable(file: string) {
  return fs
    .access(file, constants.X_OK)
    .then(() => true)
    .catch(() => false)
}

async function version(binaryPath: string) {
  const direct = await Process.text([binaryPath, "--version"], { timeout: 3000, nothrow: true }).catch(() => undefined)
  if (direct?.code === 0) {
    const text = direct.text.trim() || direct.stderr.toString().trim()
    if (text) return text
  }

  // The Python-distributed AX Engine wrapper exposes its version through the
  // structured doctor response rather than a top-level --version flag.
  const doctor = await Process.text([binaryPath, "doctor", "--json"], { timeout: 10_000, nothrow: true }).catch(
    () => undefined,
  )
  if (doctor?.code !== 0) return undefined
  const parsed = parseJsonResult(doctor.text.trim())
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return undefined
  const install = (parsed.value as Record<string, unknown>).install
  if (!install || typeof install !== "object") return undefined
  const value = (install as Record<string, unknown>).version
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function unsupportedVersionBlocker(detected: string | undefined) {
  if (!detected) return undefined
  const parsed = semver.coerce(detected)
  if (!parsed || semver.gte(parsed, AX_ENGINE_MIN_VERSION)) return undefined
  return `${AX_ENGINE_ERROR.VersionUnsupported}: ax-engine ${parsed.version} is installed; ${AX_ENGINE_MIN_VERSION} or later is required`
}

export async function getDependencyStatus(options: AxEngineDependencyOptions = {}): Promise<AxEngineDependencyStatus> {
  const configured =
    typeof options.binaryPath === "string" && options.binaryPath.trim() ? options.binaryPath.trim() : undefined
  const env = process.env.AX_ENGINE_BIN
  const candidate = configured ?? env

  // Resolution order: an explicit binary (config/env) or an existing PATH
  // install always wins, so a deliberate user setup is respected. The AX
  // Code-managed install is the fallback used when nothing else is present.
  if (candidate) {
    if (!(await isExecutable(candidate))) {
      return {
        available: false,
        mode: "configured",
        binaryPath: candidate,
        installable: false,
        blockers: [`${AX_ENGINE_ERROR.BinaryMissing}: configured ax-engine binary is not executable`],
      }
    }
    const detectedVersion = await version(candidate)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    return {
      available: !versionBlocker,
      mode: "configured",
      binaryPath: candidate,
      version: detectedVersion,
      installable: false,
      blockers: versionBlocker ? [versionBlocker] : [],
    }
  }

  const found = which("ax-engine")
  if (found) {
    const detectedVersion = await version(found)
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    return {
      available: !versionBlocker,
      mode: "path",
      binaryPath: found,
      version: detectedVersion,
      installable: false,
      blockers: versionBlocker ? [versionBlocker] : [],
    }
  }

  const managed = await getManagedBinary()
  if (managed) {
    // Prefer the live --version output when present; fall back to the install
    // marker so a bumped AX_ENGINE_MIN_VERSION still gates stale managed installs
    // the same way PATH/configured binaries are gated.
    const detectedVersion = (await version(managed.path)) ?? managed.version
    const versionBlocker = unsupportedVersionBlocker(detectedVersion)
    return {
      available: !versionBlocker,
      mode: "managed",
      binaryPath: managed.path,
      version: detectedVersion,
      managedVersion: managed.version,
      installable: versionBlocker ? isAxEngineInstallable() : false,
      blockers: versionBlocker ? [versionBlocker] : [],
    }
  }

  const installable = isAxEngineInstallable()
  return {
    available: false,
    mode: "missing",
    installable,
    blockers: [
      installable
        ? `${AX_ENGINE_ERROR.BinaryMissing}: ax-engine is not installed — install it from AX Code to run local models`
        : `${AX_ENGINE_ERROR.BinaryMissing}: install ax-engine or configure provider.ax-engine.options.binaryPath`,
    ],
  }
}
