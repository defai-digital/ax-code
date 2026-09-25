import { runModeLabel } from "../../../src/cli/tui/component/prompt/run-mode-view-model"
import { workModeAvailability, workModePickerOptions } from "../../../src/cli/tui/component/work-mode-availability"
import { untranslatedVisibleCopy } from "../../../script/tui-localization-source"
import { describe, expect, test } from "vitest"
import { LOCALES, dictionaries, translate, conversationInstruction, type Translate } from "../../../src/cli/tui/i18n"
import { validateCatalogs } from "../../../src/cli/tui/i18n/validate"
import { dialogHelpGroups } from "../../../src/cli/tui/ui/dialog-help-view-model"
import { footerGoalChip, footerSessionStatusView } from "../../../src/cli/tui/routes/session/footer-view-model"
import { truncateToCellWidth } from "../../../src/cli/tui/routes/session/last-input-view-model"
import { createLanguagePreferences } from "../../../src/cli/tui/i18n/preferences"
import { Locale } from "../../../src/util/locale"
import { stringWidth } from "../../../src/bun/node-compat"
import { Keybinds } from "../../../src/config/schema"

describe("complete locale presentation", () => {
  test.each(LOCALES)("%s translates runtime projections without changing evidence", (locale) => {
    const t: Translate = (key, params) => translate(locale, key, params)
    expect(runModeLabel("none", t)).toBe(t("mode.manual"))
    expect(runModeLabel("auto", t)).toBe(t("ui.auto"))
    expect(runModeLabel("super-long", t)).toBe(t("mode.longRun"))
    expect(t("ui.widthWidth", { width: 36 })).toContain("36")
    const availability = workModeAvailability({ t, mode: "council", providers: [], providerLoaded: true })
    expect(availability.state).toBe("unavailable")
    expect(availability.reason).toBe("needs 2")
    expect(availability.detail).toBe(t("mode.providers", { mode: "Council", count: 0 }))
    const modes = workModePickerOptions({ t, providers: [], providerLoaded: true })
    expect(modes[0].title).toBe(t("category.agent"))
    expect(modes[0].disabled).toBe(false)
    expect(modes[1].disabled).toBe(true)
    const objective = "Keep /tmp/$&/{name}.ts intact"
    const chip = footerGoalChip({ t, goal: { status: "paused", objective }, maxObjective: 100 })!
    expect(chip.label).toContain(t("ui.goalPaused"))
    expect(chip.label).toContain(objective)
    expect(chip.resumeHint).toBe("/goal resume")
    const status = footerSessionStatusView({ t, status: { type: "busy", waitState: "tool", activeTool: "read" } })
    expect(status.label).toBe(t("ui.scanningFiles"))
    expect(status.tone).toBe("working")
    const groups = dialogHelpGroups(t)
    expect(
      groups
        .flatMap((group) => group.binds)
        .map((bind) => bind.key)
        .sort(),
    ).toEqual(Object.keys(Keybinds.shape).sort())
    for (const bind of groups.flatMap((group) => group.binds))
      expect(bind.label).toBe(t(`help.keybind.${bind.key as keyof typeof Keybinds.shape}`))
    expect(conversationInstruction(locale)).not.toContain("undefined")
  })

  test("catalog validation rejects silent English copies and decomposed text", () => {
    expect(
      validateCatalogs({ vi: { ...dictionaries.vi, "language.title": dictionaries.en["language.title"] } }),
    ).toContain("vi: untranslated language.title")
    expect(
      validateCatalogs({
        vi: { ...dictionaries.vi, "language.title": dictionaries.vi["language.title"].normalize("NFD") },
      }),
    ).toContain("vi: non-NFC language.title")
    expect(validateCatalogs()).toEqual([])
  })

  test.each(LOCALES)("%s persists separately from conversation and updates an existing translator", (locale) => {
    const saved = new Map<string, string>()
    const kv = {
      get: (key: string, fallback?: unknown) => saved.get(key) ?? fallback,
      set: (key: string, value: string) => {
        saved.set(key, value)
      },
    }
    const preferences = createLanguagePreferences(kv, { interface_language: "en", conversation_language: "auto" })
    const t = preferences.t
    preferences.setLocale(locale)
    expect(t("language.title")).toBe(dictionaries[locale]["language.title"])
    expect(preferences.conversation()).toBe("auto")
    const reloaded = createLanguagePreferences(kv, { interface_language: "en" })
    expect(reloaded.locale()).toBe(locale)
    preferences.setConversation(locale)
    expect(reloaded.conversation()).toBe(locale)
    expect(reloaded.locale()).toBe(locale)
  })

  test("Vietnamese NFC and NFD truncation preserves accents and narrow budgets", () => {
    const nfc = "\u1ec7\u1eef\u01a1\u0111"
    const nfd = nfc.normalize("NFD")
    expect(stringWidth(nfc)).toBe(4)
    expect(stringWidth(nfd)).toBe(4)
    expect(Locale.truncate(nfd, 3)).toBe("\u1ec7\u1eef".normalize("NFD") + "\u2026")
    expect(Locale.truncate("\ud83d\udc69\u200d\ud83d\udcbbabc", 2)).toBe("\ud83d\udc69\u200d\ud83d\udcbb\u2026")
    for (let width = 0; width <= 8; width++) {
      const clipped = truncateToCellWidth(nfd + "abcdef", width)
      expect(stringWidth(clipped)).toBeLessThanOrEqual(width)
      expect(clipped.normalize("NFC")).toBe(truncateToCellWidth(nfc + "abcdef", width))
    }
  })
})

test("visible-copy guard catches JSX and conditional labels without translating identifiers", () => {
  const source =
    'const row = { value: "session.rename", title: active ? "Hide sidebar" : t("action.show"), description: `Connect ${provider}` }; const view = <text>English copy</text>'
  const errors = untranslatedVisibleCopy("fixture.tsx", source)
  expect(errors).toHaveLength(3)
  expect(errors.join("\n")).not.toContain("session.rename")
  expect(untranslatedVisibleCopy("fixture.tsx", '<DialogSelect title={t("language.title")} current="en" />')).toEqual(
    [],
  )
})

test("visible-copy guard catches dynamic width chrome while preserving layout enums", () => {
  expect(
    untranslatedVisibleCopy(
      "sidebar.tsx",
      '<box position={open ? "absolute" : "relative"}><ChromeAction>{`Width ${width}`}</ChromeAction></box>',
    ),
  ).toEqual(["sidebar.tsx:1: untranslated visible copy: Width"])
})
