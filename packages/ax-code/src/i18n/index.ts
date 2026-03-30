/**
 * i18n Module — Internationalization
 *
 * Supports 11 languages with English fallback.
 *
 * Usage:
 *   import { t, setLanguage } from "../i18n"
 *   setLanguage("zh-CN")
 *   console.log(t("session.thinking")) // "思考中..."
 */

export { getTranslations, t, setLanguage, getLanguage, getAvailableLanguages } from "./loader"
export type { SupportedLanguage, Translations } from "./types"
export { LANGUAGE_NAMES } from "./types"
