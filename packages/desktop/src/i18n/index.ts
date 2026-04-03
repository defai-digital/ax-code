import * as i18n from "@solid-primitives/i18n"

import { dict as desktopEn } from "./en"
import { dict as appEn } from "../../../app/src/i18n/en"

export type Locale = "en"

type RawDictionary = typeof appEn & typeof desktopEn
type Dictionary = i18n.Flatten<RawDictionary>

const base = i18n.flatten({ ...appEn, ...desktopEn })

const state = {
  locale: "en" as Locale,
  dict: base as Dictionary,
  init: undefined as Promise<Locale> | undefined,
}

const translate = i18n.translator(() => state.dict, i18n.resolveTemplate)

export function t(key: keyof Dictionary, params?: Record<string, string | number>) {
  return translate(key, params)
}

export function initI18n(): Promise<Locale> {
  if (state.init) return state.init
  state.init = Promise.resolve("en" as Locale)
  return state.init
}
