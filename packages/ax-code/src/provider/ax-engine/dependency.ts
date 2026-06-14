import fs from "fs/promises"
import { constants } from "fs"
import z from "zod"
import { which } from "@/util/which"
import { Process } from "@/util/process"
import { AX_ENGINE_ERROR } from "./constants"

export const AxEngineDependencyStatus = z.object({
  available: z.boolean(),
  mode: z.enum(["configured", "path", "missing"]),
  binaryPath: z.string().optional(),
  version: z.string().optional(),
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

  if (candidate) {
    if (!(await isExecutable(candidate))) {
      return {
        available: false,
        mode: "configured",
        binaryPath: candidate,
        blockers: [`${AX_ENGINE_ERROR.BinaryMissing}: configured ax-engine binary is not executable`],
      }
    }
    return {
      available: true,
      mode: "configured",
      binaryPath: candidate,
      version: await version(candidate),
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
      blockers: [],
    }
  }

  return {
    available: false,
    mode: "missing",
    blockers: [
      `${AX_ENGINE_ERROR.BinaryMissing}: install ax-engine or configure provider.ax-engine.options.binaryPath`,
    ],
  }
}
