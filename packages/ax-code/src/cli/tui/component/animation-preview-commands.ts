import type { Translate } from "../i18n"
import type { CommandOption } from "./dialog-command"
import type { OverlayStyle } from "./foliage-view-model"

const PREVIEWS = [
  {
    family: "Digital Code",
    ending: false,
    style: "digital-code",
    key: "animation.digitalOpening",
    value: "app.digital_code.original",
    slash: "digital-code",
  },
  {
    family: "Digital Code",
    ending: true,
    style: "digital-code",
    key: "animation.digitalEnding",
    value: "app.digital_code.original_reverse",
    slash: "digital-code-ending",
  },
  {
    family: "Foliage",
    ending: false,
    style: "classic-foliage",
    key: "animation.classicFoliage",
    value: "app.animation.foliage",
    slash: "foliage",
  },
  {
    family: "Foliage",
    ending: true,
    style: "golden-foliage",
    key: "animation.goldenFoliage",
    value: "app.animation.foliage_ending",
    slash: "foliage-ending",
  },
  {
    family: "Bench",
    ending: false,
    style: "midnight-dream",
    key: "animation.midnightDream",
    value: "app.animation.bench",
    slash: "bench",
  },
  {
    family: "Bench",
    ending: true,
    style: "sunset-serenade",
    key: "animation.sunsetSerenade",
    value: "app.animation.bench_ending",
    slash: "bench-ending",
  },
  {
    family: "Fuji Mountain",
    ending: false,
    style: "fuji-day",
    key: "animation.fujiDay",
    value: "app.animation.fuji",
    slash: "fuji",
  },
  {
    family: "Fuji Mountain",
    ending: true,
    style: "fuji-night",
    key: "animation.fujiNight",
    value: "app.animation.fuji_ending",
    slash: "fuji-ending",
  },
  {
    family: "Mahjong",
    ending: false,
    style: "mahjong-match",
    key: "animation.mahjongMatch",
    value: "app.animation.mahjong",
    slash: "mahjong",
  },
  {
    family: "Mahjong",
    ending: true,
    style: "mahjong-ending",
    key: "animation.mahjongEnding",
    value: "app.animation.mahjong_ending",
    slash: "mahjong-ending",
  },
] as const

/** Named theme families remain searchable in every interface language. */
export function animationPreviewCommands(input: {
  t: Translate
  opening: (style: OverlayStyle) => void
  ending: (style: OverlayStyle) => void
}): CommandOption[] {
  return PREVIEWS.map((preview) => ({
    title:
      preview.style === "digital-code"
        ? input.t(preview.key)
        : `${input.t(preview.ending ? "command.ending" : "command.opening")} - ${input.t(preview.key)}`,
    value: preview.value,
    category: `${input.t("category.system")} - ${preview.family}`,
    slash: { name: preview.slash, hidden: true },
    onSelect: (dialog) => {
      dialog.clear()
      if (preview.ending) input.ending(preview.style)
      else input.opening(preview.style)
    },
  }))
}
