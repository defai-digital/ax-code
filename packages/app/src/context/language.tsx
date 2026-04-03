import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@ax-code/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as uiEn } from "@ax-code/ui/i18n/en"

export type Locale = "en"

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

const LOCALES: readonly Locale[] = ["en"]

const INTL: Record<Locale, string> = {
  en: "en",
}

const LABEL_KEY: Record<Locale, keyof Dictionary> = {
  en: "language.en",
}

const base = i18n.flatten({ ...en, ...uiEn })

export function loadLocaleDict(_locale: Locale) {
  return Promise.resolve(undefined)
}

export function normalizeLocale(_value: string): Locale {
  return "en"
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
      createStore({
        locale: "en" as Locale,
      }),
    )

    const locale = createMemo<Locale>(() => "en")
    const intl = createMemo(() => INTL[locale()])

    const [dict] = createResource(locale, () => Promise.resolve(base), {
      initialValue: base,
    })

    const t = i18n.translator(() => dict() ?? base, i18n.resolveTemplate) as (
      key: keyof Dictionary,
      params?: Record<string, string | number | boolean>,
    ) => string

    const label = (value: Locale) => t(LABEL_KEY[value])

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = "en"
    })

    return {
      ready,
      locale,
      intl,
      locales: LOCALES,
      label,
      t,
      setLocale(_next: Locale) {
        setStore("locale", "en")
      },
    }
  },
})
