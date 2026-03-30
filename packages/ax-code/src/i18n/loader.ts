/**
 * i18n Loader
 * Loads translation JSON files with caching and English fallback
 */

import fs from "fs"
import path from "path"
import type { SupportedLanguage, Translations } from "./types"

const cache = new Map<string, Translations>()
let currentLanguage: SupportedLanguage = "en"

function getLocalePath(lang: SupportedLanguage): string {
  return path.join(import.meta.dir, "locales", lang, "ui.json")
}

function loadLocale(lang: SupportedLanguage): Translations | null {
  if (cache.has(lang)) return cache.get(lang)!

  const filePath = getLocalePath(lang)
  try {
    const text = fs.readFileSync(filePath, "utf-8")
    const translations = JSON.parse(text) as Translations
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
  const keys = key.split(".")
  let value: any = translations
  for (const k of keys) {
    value = value?.[k]
    if (value === undefined) break
  }

  if (typeof value === "string") return value

  // Fallback to English
  if ((lang ?? currentLanguage) !== "en") {
    const english = getTranslations("en")
    let enValue: any = english
    for (const k of keys) {
      enValue = enValue?.[k]
      if (enValue === undefined) break
    }
    if (typeof enValue === "string") return enValue
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
  const localesDir = path.join(import.meta.dir, "locales")
  try {
    return fs.readdirSync(localesDir).filter((dir) => {
      return fs.existsSync(path.join(localesDir, dir, "ui.json"))
    }) as SupportedLanguage[]
  } catch {
    return ["en"]
  }
}
