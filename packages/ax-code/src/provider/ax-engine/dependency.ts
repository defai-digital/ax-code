import fs from "fs/promises"
import { constants } from "fs"
import z from "zod"
import { which } from "@/util/which"
import { Process } from "@/util/process"
import { AX_ENGINE_ERROR } from "./constants"
import { getManagedBinary, isAxEngineInstallable } from "./install"

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
  return Process.text([binaryPath, "--version"], { timeout: 3000, nothrow: true })
    .then((out) => {
      const text = out.text.trim() || out.stderr.toString().trim()
      return out.code === 0 && text ? text : undefined
    })
    .catch(() => undefined)
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
    return {
      available: true,
      mode: "configured",
      binaryPath: candidate,
      version: await version(candidate),
      installable: false,
      blockers: [],
    }
  }

  const found = which("ax-engine")
  if (found) {
    return {
      available: true,
      mode: "path",
      binaryPath: found,
      version: await version(found),
      installable: false,
      blockers: [],
    }
  }

  const managed = await getManagedBinary()
  if (managed) {
    return {
      available: true,
      mode: "managed",
      binaryPath: managed.path,
      version: await version(managed.path),
      managedVersion: managed.version,
      installable: false,
      blockers: [],
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
