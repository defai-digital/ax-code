import { z } from "zod"
import { Process } from "@/util/process"
import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
import { cliEnv } from "./cli-language-model"
import type { NativeCliModel } from "./native-models"

const MODEL_DISCOVERY_TIMEOUT_MS = 10_000
const MAX_DISCOVERED_MODELS = 1_024
const log = Log.create({ service: "provider.cli.antigravity" })
const modelRow = z.tuple([z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/), z.string().min(1)])

/** `agy models` emits slug<TAB>display name; progress goes to stderr. */
export function parseAntigravityModels(output: string): NativeCliModel[] {
  const models = new Map<string, NativeCliModel>()
  for (const line of output.split("\n")) {
    const parsed = modelRow.safeParse(
      line
        .trim()
        .split("\t")
        .map((value) => value.trim()),
    )
    if (!parsed.success) continue
    const [id, name] = parsed.data
    // Keep an unexpectedly large external catalog from overwhelming the model picker.
    if (!models.has(id) && models.size >= MAX_DISCOVERED_MODELS) continue
    models.set(id, { id, name })
  }
  return [...models.values()]
}

/** Model enumeration spends no inference and never reads credential storage. */
export async function discoverAntigravityModels(binary: string): Promise<NativeCliModel[]> {
  try {
    const result = await Process.run([binary, "models"], {
      stdin: "ignore",
      env: cliEnv([], "antigravity-cli"),
      timeout: MODEL_DISCOVERY_TIMEOUT_MS,
      nothrow: true,
    })
    return result.code === 0 ? parseAntigravityModels(result.stdout.toString()) : []
  } catch (error) {
    log.debug("model discovery failed", { error: toErrorMessage(error) })
    return []
  }
}
