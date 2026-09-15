import {
  conversationInstruction,
  conversationLanguage,
  interfaceLanguage,
  translate,
  type ConversationLanguage,
  type InterfaceLanguage,
  type Translate,
} from "./index"

export function createLanguagePreferences(
  kv: { get: (key: string, fallback?: unknown) => unknown; set: (key: string, value: string) => void },
  config: { interface_language?: InterfaceLanguage; conversation_language?: ConversationLanguage },
) {
  const locale = () => interfaceLanguage(kv.get("interface_language", config.interface_language))
  const conversation = () => conversationLanguage(kv.get("conversation_language", config.conversation_language))
  return {
    locale,
    conversation,
    setLocale: (value: InterfaceLanguage) => kv.set("interface_language", interfaceLanguage(value)),
    setConversation: (value: ConversationLanguage) => kv.set("conversation_language", conversationLanguage(value)),
    t: ((key, params) => translate(locale(), key, params)) as Translate,
    system: () => conversationInstruction(conversation()),
  }
}
