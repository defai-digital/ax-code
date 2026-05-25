/**
 * i18n Loader
 * Loads translation JSON files with caching and English fallback
 */

import fs from "fs"
import path from "path"
import type { SupportedLanguage, Translations } from "./types"

const cache = new Map<string, Translations>()
let currentLanguage: SupportedLanguage = "en"
let availableLanguagesCache: SupportedLanguage[] | null = null
const REQUIRED_TRANSLATION_PATHS = [
  "session.welcome",
  "session.thinking",
  "session.generating",
  "session.goodbye",
  "session.sessionEnded",
  "tools.executing",
  "tools.completed",
  "tools.failed",
  "tools.readingFile",
  "tools.writingFile",
  "tools.searchingFiles",
  "tools.commandRunning",
  "tools.commandCompleted",
  "errors.connectionFailed",
  "errors.apiError",
  "errors.rateLimited",
  "errors.timeout",
  "errors.permissionDenied",
  "errors.fileNotFound",
  "errors.invalidInput",
  "errors.unknown",
  "toast.copiedToClipboard",
  "toast.changesSaved",
  "toast.operationCancelled",
  "toast.agentSwitched",
  "usage.tokens",
  "usage.tokensIn",
  "usage.tokensOut",
  "status.thinking",
  "status.context",
  "status.contextWarning",
] as const

function getLocalePath(lang: SupportedLanguage): string {
  return path.join(import.meta.dir, "locales", lang, "ui.json")
}

function translationValue(value: unknown, key: string): unknown {
  let current = value
  for (const segment of key.split(".")) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function lookupTranslation(value: unknown, key: string): string | undefined {
  const translation = translationValue(value, key)
  return typeof translation === "string" ? translation : undefined
}

export function parseTranslationsText(text: string): Translations {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error("i18n locale: invalid JSON", { cause: error })
  }

  return decodeTranslationsValue(parsed)
}

export function decodeTranslationsValue(value: unknown): Translations {
  const missing = REQUIRED_TRANSLATION_PATHS.filter((key) => lookupTranslation(value, key) === undefined)
  if (missing.length) {
    throw new Error(`i18n locale: missing translation strings (${missing.join(", ")})`)
  }
  return value as Translations
}

function loadLocale(lang: SupportedLanguage): Translations | null {
  if (cache.has(lang)) return cache.get(lang)!

  const filePath = getLocalePath(lang)
  try {
    const text = fs.readFileSync(filePath, "utf-8")
    const translations = parseTranslationsText(text)
    cache.set(lang, translations)
    return translations
  } catch {
    return null
  }
}

/**
 * Get translations for the current or specified language
 * Falls back to English if translation is missing
 */
export function getTranslations(lang?: SupportedLanguage): Translations {
  const targetLang = lang ?? currentLanguage
  const translations = loadLocale(targetLang)
  if (translations) return translations

  // Fallback to English
  const english = loadLocale("en")
  if (english) return english

  // Should never happen — English is always available
  throw new Error("Failed to load English translations")
}

/**
 * Get a specific translation key with fallback
 */
export function t(key: string, lang?: SupportedLanguage): string {
  const translations = getTranslations(lang)
  const value = lookupTranslation(translations, key)
  if (value !== undefined) return value

  // Fallback to English
  if ((lang ?? currentLanguage) !== "en") {
    const english = getTranslations("en")
    const enValue = lookupTranslation(english, key)
    if (enValue !== undefined) return enValue
  }

  return key // Return key itself as last resort
}

/**
 * Set the current language
 */
export function setLanguage(lang: SupportedLanguage) {
  currentLanguage = lang
}

/**
 * Get the current language
 */
export function getLanguage(): SupportedLanguage {
  return currentLanguage
}

/**
 * Get list of available languages
 */
export function getAvailableLanguages(): SupportedLanguage[] {
  if (availableLanguagesCache) return availableLanguagesCache
  const localesDir = path.join(import.meta.dir, "locales")
  try {
    availableLanguagesCache = fs.readdirSync(localesDir).filter((dir) => {
      return fs.existsSync(path.join(localesDir, dir, "ui.json"))
    }) as SupportedLanguage[]
    return availableLanguagesCache
  } catch {
    return ["en"]
  }
}
