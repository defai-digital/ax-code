const legacyPreloadSpecifier: string = "@opentui/solid/preload"
const runtimePluginSupportSpecifier: string = "@opentui/solid/runtime-plugin-support"

function isMissingLegacyPreload(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes(legacyPreloadSpecifier) && /not found|Cannot find|Could not resolve|Module not found/.test(message)
  )
}

async function loadOpenTuiPreload() {
  try {
    await import(legacyPreloadSpecifier)
    return
  } catch (legacyError) {
    if (!isMissingLegacyPreload(legacyError)) {
      throw legacyError
    }

    try {
      await import(runtimePluginSupportSpecifier)
      return
    } catch (runtimeSupportError) {
      const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError)
      const runtimeSupportMessage =
        runtimeSupportError instanceof Error ? runtimeSupportError.message : String(runtimeSupportError)

      throw new Error(
        [
          "Unable to load OpenTUI Solid preload support.",
          `Tried ${legacyPreloadSpecifier}: ${legacyMessage}`,
          `Tried ${runtimePluginSupportSpecifier}: ${runtimeSupportMessage}`,
          "Run pnpm install --frozen-lockfile from the repository root and verify @opentui/solid is installed.",
        ].join("\n"),
      )
    }
  }
}

await loadOpenTuiPreload()
