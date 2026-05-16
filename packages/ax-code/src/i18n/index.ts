/**
 * i18n Module
 *
 * English only. The language infrastructure is retained for future use
 * but all non-English locales have been removed.
 */

export { getTranslations, t, setLanguage, getLanguage, getAvailableLanguages } from "./loader"
export type { SupportedLanguage, Translations } from "./types"
export { LANGUAGE_NAMES } from "./types"
