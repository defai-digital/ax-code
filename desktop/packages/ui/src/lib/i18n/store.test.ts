import { beforeEach, describe, expect, test } from "vitest"
import { DEFAULT_LOCALE } from "./runtime"
import { resetI18nDictionaryCacheForTests, useI18nStore } from "./store"

const defaultDictionary = useI18nStore.getState().dictionary

const resetStore = () => {
  resetI18nDictionaryCacheForTests()
  useI18nStore.setState({
    locale: DEFAULT_LOCALE,
    dictionary: defaultDictionary,
    loadingLocale: null,
  })
}

describe("i18n store", () => {
  beforeEach(resetStore)

  test("only the English locale is supported", () => {
    useI18nStore.getState().setLocale(DEFAULT_LOCALE)

    const state = useI18nStore.getState()
    expect(state.locale).toBe(DEFAULT_LOCALE)
    expect(state.loadingLocale).toBeNull()
    expect(state.dictionary).toBe(defaultDictionary)
  })
})
