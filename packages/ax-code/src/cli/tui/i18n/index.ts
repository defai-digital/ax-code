import { messages as en } from "./locales/en"
import { messages as zhTW } from "./locales/zh-TW"
import { messages as zhCN } from "./locales/zh-CN"
import { messages as ja } from "./locales/ja"
import { messages as ko } from "./locales/ko"

export const LOCALES = ["en", "zh-TW", "zh-CN", "ja", "ko"] as const
export type InterfaceLanguage = (typeof LOCALES)[number]
export type ConversationLanguage = InterfaceLanguage | "auto"
export type MessageKey = keyof typeof en
export type Dictionary = Record<MessageKey, string>
export type MessageParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: MessageParams) => string

export const dictionaries: Record<InterfaceLanguage, Dictionary> = { en, "zh-TW": zhTW, "zh-CN": zhCN, ja, ko }
export const LANGUAGE_LABELS: Record<InterfaceLanguage, string> = {
  en: "English",
  "zh-TW": "\u7e41\u9ad4\u4e2d\u6587",
  "zh-CN": "\u7b80\u4f53\u4e2d\u6587",
  ja: "\u65e5\u672c\u8a9e",
  ko: "\ud55c\uad6d\uc5b4",
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
