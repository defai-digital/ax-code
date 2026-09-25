import { messages as vi } from "./locales/vi"
import { messages as tr } from "./locales/tr"
import { messages as id } from "./locales/id"
import { messages as ru } from "./locales/ru"
import { messages as de } from "./locales/de"
import { messages as fr } from "./locales/fr"
import { messages as ptBR } from "./locales/pt-BR"
import { messages as es } from "./locales/es"
import { LOCALES } from "../../../config/languages"
export { LOCALES }
import { messages as en } from "./locales/en"
import { messages as zhTW } from "./locales/zh-TW"
import { messages as zhCN } from "./locales/zh-CN"
import { messages as ja } from "./locales/ja"
import { messages as ko } from "./locales/ko"

export type InterfaceLanguage = (typeof LOCALES)[number]
export type ConversationLanguage = InterfaceLanguage | "auto"
export type MessageKey = keyof typeof en
export type Dictionary = Record<MessageKey, string>
export type MessageParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: MessageParams) => string

export const dictionaries: Record<InterfaceLanguage, Dictionary> = {
  en,
  "zh-TW": zhTW,
  "zh-CN": zhCN,
  ja,
  ko,
  es,
  "pt-BR": ptBR,
  fr,
  de,
  ru,
  id,
  tr,
  vi,
}
export const LANGUAGE_LABELS: Record<InterfaceLanguage, string> = {
  en: "English",
  "zh-TW": "\u7e41\u9ad4\u4e2d\u6587",
  "zh-CN": "\u7b80\u4f53\u4e2d\u6587",
  ja: "\u65e5\u672c\u8a9e",
  ko: "\ud55c\uad6d\uc5b4",
  es: "Espa\u00f1ol",
  "pt-BR": "Portugu\u00eas (Brasil)",
  fr: "Fran\u00e7ais",
  de: "Deutsch",
  ru: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
  id: "Bahasa Indonesia",
  tr: "T\u00fcrk\u00e7e",
  vi: "Ti\u1ebfng Vi\u1ec7t",
}

export function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
  return typeof value === "string" && LOCALES.some((locale) => locale === value)
}

export function interfaceLanguage(value: unknown): InterfaceLanguage {
  return isInterfaceLanguage(value) ? value : "en"
}

export function conversationLanguage(value: unknown): ConversationLanguage {
  return isInterfaceLanguage(value) ? value : "auto"
}

export function translate(locale: InterfaceLanguage, key: MessageKey, params?: MessageParams): string {
  const template = dictionaries[locale]?.[key] ?? en[key]
  // Callback replacement preserves literal dollar signs and braces in evidence.
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

export const english: Translate = (key, params) => translate("en", key, params)

const CONVERSATION_NAMES: Record<InterfaceLanguage, string> = {
  en: "English",
  "zh-TW": "Traditional Chinese (Taiwan), not Simplified Chinese",
  "zh-CN": "Simplified Chinese, not Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  "pt-BR": "Brazilian Portuguese",
  fr: "French",
  de: "German",
  ru: "Russian",
  id: "Indonesian",
  tr: "Turkish",
  vi: "Vietnamese",
}

export function conversationInstruction(locale: ConversationLanguage): string | undefined {
  if (locale === "auto") return undefined
  return [
    `Conversation preference: write user-facing explanations and summaries in ${CONVERSATION_NAMES[locale]}.`,
    "Explicit user language requests and project instructions take precedence over this preference.",
    "Follow project rules for code comments, commits, and documents; otherwise keep these artifacts in English.",
    "Preserve technical identifiers, commands, paths, quoted evidence, original task constraints, test results, and raw tool output exactly.",
    "For Council and Arena, localize the explanatory presentation only; do not translate member evidence before aggregation or change severity, support counts, or rankings.",
  ].join("\n")
}
