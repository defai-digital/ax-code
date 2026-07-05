export const createThemeRuntime = (dependencies) => {
  const { fsPromises, path, themesDir, maxThemeJsonBytes, logger } = dependencies

  const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "")
  const isNonEmptyString = (value) => asTrimmedString(value).length > 0
  const isValidThemeColor = (value) => isNonEmptyString(value)

  const normalizeThemeJson = (raw) => {
    if (!raw || typeof raw !== "object") {
      return null
    }

    const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : null
    const colors = raw.colors && typeof raw.colors === "object" ? raw.colors : null
    if (!metadata || !colors) {
      return null
    }

    const id = metadata.id
    const name = metadata.name
    const variant = metadata.variant
    if (!isNonEmptyString(id) || !isNonEmptyString(name) || (variant !== "light" && variant !== "dark")) {
      return null
    }

    const primary = colors.primary
    const surface = colors.surface
    const interactive = colors.interactive
    const status = colors.status
    const syntax = colors.syntax
    const syntaxBase = syntax && typeof syntax === "object" ? syntax.base : null
    const syntaxHighlights = syntax && typeof syntax === "object" ? syntax.highlights : null

    if (!primary || !surface || !interactive || !status || !syntaxBase || !syntaxHighlights) {
      return null
    }

    // Minimal fields required by CSSVariableGenerator and diff/syntax rendering.
    const required = [
      primary.base,
      primary.foreground,
      surface.background,
      surface.foreground,
      surface.muted,
      surface.mutedForeground,
      surface.elevated,
      surface.elevatedForeground,
      surface.subtle,
      interactive.border,
      interactive.selection,
      interactive.selectionForeground,
      interactive.focusRing,
      interactive.hover,
      status.error,
      status.errorForeground,
      status.errorBackground,
      status.errorBorder,
      status.warning,
      status.warningForeground,
      status.warningBackground,
      status.warningBorder,
      status.success,
      status.successForeground,
      status.successBackground,
      status.successBorder,
      status.info,
      status.infoForeground,
      status.infoBackground,
      status.infoBorder,
      syntaxBase.background,
      syntaxBase.foreground,
      syntaxBase.keyword,
      syntaxBase.string,
      syntaxBase.number,
      syntaxBase.function,
      syntaxBase.variable,
      syntaxBase.type,
      syntaxBase.comment,
      syntaxBase.operator,
      syntaxHighlights.diffAdded,
      syntaxHighlights.diffRemoved,
      syntaxHighlights.lineNumber,
    ]

    if (!required.every(isValidThemeColor)) {
      return null
    }

    const tags = Array.isArray(metadata.tags) ? metadata.tags.map(asTrimmedString).filter((tag) => tag.length > 0) : []
    const version = asTrimmedString(metadata.version) || "1.0.0"

    return {
      ...raw,
      metadata: {
        ...metadata,
        id: asTrimmedString(id),
        name: asTrimmedString(name),
        description: typeof metadata.description === "string" ? metadata.description : "",
        version,
        variant,
        tags,
      },
    }
  }

  const readCustomThemesFromDisk = async () => {
    try {
      const entries = await fsPromises.readdir(themesDir, { withFileTypes: true })
      const themes = []
      const seen = new Set()

      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (!entry.name.toLowerCase().endsWith(".json")) continue

        const filePath = path.join(themesDir, entry.name)
        let handle
        try {
          handle = await fsPromises.open(filePath, "r")
          const stat = await handle.stat()
          if (!stat.isFile()) continue
          if (stat.size > maxThemeJsonBytes) {
            logger.warn(`[themes] Skip ${entry.name}: too large (${stat.size} bytes)`)
            continue
          }

          const rawText = await handle.readFile("utf8")
          const parsed = JSON.parse(rawText)
          const normalized = normalizeThemeJson(parsed)
          if (!normalized) {
            logger.warn(`[themes] Skip ${entry.name}: invalid theme JSON`)
            continue
          }

          const id = normalized.metadata.id
          if (seen.has(id)) {
            logger.warn(`[themes] Skip ${entry.name}: duplicate theme id "${id}"`)
            continue
          }

          seen.add(id)
          themes.push(normalized)
        } catch (error) {
          logger.warn(`[themes] Failed to read ${entry.name}:`, error)
        } finally {
          await handle?.close()
        }
      }

      return themes
    } catch (error) {
      // Missing dir is fine.
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return []
      }
      logger.warn("[themes] Failed to list custom themes dir:", error)
      return []
    }
  }

  return {
    normalizeThemeJson,
    readCustomThemesFromDisk,
  }
}
