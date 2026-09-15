import { Filesystem } from "@/util/filesystem"
import { optionalStateErrorCode } from "./optional-state"

export type OptionalJsonState<T> =
  | {
      status: "found"
      value: T
    }
  | {
      status: "missing"
    }
  | {
      status: "invalid"
      error: unknown
    }

export async function readOptionalJsonState<T>(filePath: string): Promise<OptionalJsonState<T>> {
  try {
    return {
      status: "found",
      value: await Filesystem.readJson<T>(filePath),
    }
  } catch (error) {
    if (optionalStateErrorCode(error) === "ENOENT") return { status: "missing" }
    return {
      status: "invalid",
      error,
    }
  }
}
