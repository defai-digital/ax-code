export type AnimationPair = Readonly<{
  opening:
    | "digital-code"
    | "classic-foliage"
    | "midnight-dream"
    | "fuji-day"
    | "mahjong-match"
    | "city-night"
    | "festival-fireworks"
    | "snowfall"
    | "volcano-eruption"
  ending:
    | "digital-code"
    | "golden-foliage"
    | "sunset-serenade"
    | "fuji-night"
    | "mahjong-ending"
    | "city-dawn"
    | "festival-lanterns"
    | "winter-night"
    | "volcano-calm"
}>

/** Choose once per TUI launch; previews and shutdown reuse the same pair. */
export function chooseAnimationPair(random: () => number = Math.random): AnimationPair {
  const draw = random()
  if (draw < 1 / 9) return Object.freeze({ opening: "digital-code", ending: "digital-code" })
  if (draw < 2 / 9) return Object.freeze({ opening: "classic-foliage", ending: "golden-foliage" })
  if (draw < 3 / 9) return Object.freeze({ opening: "midnight-dream", ending: "sunset-serenade" })
  if (draw < 4 / 9) return Object.freeze({ opening: "fuji-day", ending: "fuji-night" })
  if (draw < 5 / 9) return Object.freeze({ opening: "mahjong-match", ending: "mahjong-ending" })
  if (draw < 6 / 9) return Object.freeze({ opening: "city-night", ending: "city-dawn" })
  if (draw < 7 / 9) return Object.freeze({ opening: "festival-fireworks", ending: "festival-lanterns" })
  if (draw < 8 / 9) return Object.freeze({ opening: "snowfall", ending: "winter-night" })
  return Object.freeze({ opening: "volcano-eruption", ending: "volcano-calm" })
}

let launchPair: AnimationPair | undefined

/**
 * The launch's selected pair, drawn once and reused for every later read. The
 * draw is cached outside any component so an error-boundary reset (which
 * rebuilds `App`) or a preview replay can never re-draw or change it.
 */
export function launchAnimationPair(): AnimationPair {
  return (launchPair ??= chooseAnimationPair())
}
