import { createContext, useContext, type ParentProps } from "solid-js"
import { useKV } from "./kv"
import { useTuiConfig } from "./tui-config"
import { createLanguagePreferences } from "../i18n/preferences"

const fallback = createLanguagePreferences({ get: () => undefined, set: () => {} }, {})
const context = createContext<ReturnType<typeof createLanguagePreferences>>(fallback)

export function LanguageProvider(props: ParentProps) {
  const value = createLanguagePreferences(useKV(), useTuiConfig())
  return <context.Provider value={value}>{props.children}</context.Provider>
}

// English fallback also supports standalone dialogs and the crash boundary.
export function useLanguage() {
  return useContext(context)
}
