export const OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER = "@opentui/solid/runtime-plugin-support"
export const OPENTUI_SOLID_LEGACY_PRELOAD_SPECIFIER = "@opentui/solid/preload"

type ImportModule = (specifier: string) => Promise<unknown>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isMissingSpecifier(error: unknown, specifier: string) {
  return (
    errorMessage(error).includes(specifier) &&
    /not found|Cannot find|Could not resolve|Module not found/.test(errorMessage(error))
  )
}

export async function loadOpenTuiPreload(importModule: ImportModule = (specifier) => import(specifier)) {
  let runtimeSupportError: unknown

  try {
    await importModule(OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER)
    return
  } catch (error) {
    if (!isMissingSpecifier(error, OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER)) {
      throw error
    }
    runtimeSupportError = error
  }

  try {
    await importModule(OPENTUI_SOLID_LEGACY_PRELOAD_SPECIFIER)
  } catch (legacyPreloadError) {
    throw new Error(
      [
        "Unable to load OpenTUI Solid preload support.",
        `Tried ${OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER}: ${errorMessage(runtimeSupportError)}`,
        `Tried ${OPENTUI_SOLID_LEGACY_PRELOAD_SPECIFIER}: ${errorMessage(legacyPreloadError)}`,
        "Run pnpm install --frozen-lockfile from the repository root and verify @opentui/solid is installed.",
      ].join("\n"),
    )
  }
}
