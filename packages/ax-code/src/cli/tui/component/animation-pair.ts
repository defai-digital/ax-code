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
    | "bigben-day"
    | "taipei101-day"
    | "greatwall-dawn"
    | "torii-day"
    | "taegeuk"
    | "sagrada-day"
    | "corcovado-day"
    | "eiffel-day"
    | "brandenburg-night"
    | "domes-snow"
    | "borobudur-mist"
    | "balloons-night"
    | "mekong-dawn"
    | "colosseum-day"
    | "space-launch"
    | "dungeon-descent"
    | "castle-day"
    | "islands-day"
    | "jungle-day"
    | "reef-day"
    | "pyramids-day"
    | "aurora-night"
    | "lighthouse-day"
    | "falls-day"
    | "steppe-day"
    | "canyon-day"
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
    | "bigben-night"
    | "taipei101-neon"
    | "greatwall-dusk"
    | "torii-night"
    | "taegeuk"
    | "sagrada-night"
    | "corcovado-gold"
    | "eiffel-night"
    | "brandenburg-dawn"
    | "domes-clear"
    | "borobudur-noon"
    | "balloons-dawn"
    | "mekong-dusk"
    | "colosseum-night"
    | "space-drift"
    | "dungeon-treasure"
    | "castle-night"
    | "islands-dusk"
    | "jungle-night"
    | "reef-night"
    | "pyramids-night"
    | "aurora-dawn"
    | "lighthouse-night"
    | "falls-moon"
    | "steppe-night"
    | "canyon-night"
}>

/** Choose once per TUI launch; previews and shutdown reuse the same pair. */
export function chooseAnimationPair(random: () => number = Math.random): AnimationPair {
  const draw = random()
  if (draw < 1 / 35) return Object.freeze({ opening: "digital-code", ending: "digital-code" })
  if (draw < 2 / 35) return Object.freeze({ opening: "classic-foliage", ending: "golden-foliage" })
  if (draw < 3 / 35) return Object.freeze({ opening: "midnight-dream", ending: "sunset-serenade" })
  if (draw < 4 / 35) return Object.freeze({ opening: "fuji-day", ending: "fuji-night" })
  if (draw < 5 / 35) return Object.freeze({ opening: "mahjong-match", ending: "mahjong-ending" })
  if (draw < 6 / 35) return Object.freeze({ opening: "city-night", ending: "city-dawn" })
  if (draw < 7 / 35) return Object.freeze({ opening: "festival-fireworks", ending: "festival-lanterns" })
  if (draw < 8 / 35) return Object.freeze({ opening: "snowfall", ending: "winter-night" })
  if (draw < 9 / 35) return Object.freeze({ opening: "volcano-eruption", ending: "volcano-calm" })
  if (draw < 10 / 35) return Object.freeze({ opening: "bigben-day", ending: "bigben-night" })
  if (draw < 11 / 35) return Object.freeze({ opening: "taipei101-day", ending: "taipei101-neon" })
  if (draw < 12 / 35) return Object.freeze({ opening: "greatwall-dawn", ending: "greatwall-dusk" })
  if (draw < 13 / 35) return Object.freeze({ opening: "torii-day", ending: "torii-night" })
  if (draw < 14 / 35) return Object.freeze({ opening: "taegeuk", ending: "taegeuk" })
  if (draw < 15 / 35) return Object.freeze({ opening: "sagrada-day", ending: "sagrada-night" })
  if (draw < 16 / 35) return Object.freeze({ opening: "corcovado-day", ending: "corcovado-gold" })
  if (draw < 17 / 35) return Object.freeze({ opening: "eiffel-day", ending: "eiffel-night" })
  if (draw < 18 / 35) return Object.freeze({ opening: "brandenburg-night", ending: "brandenburg-dawn" })
  if (draw < 19 / 35) return Object.freeze({ opening: "domes-snow", ending: "domes-clear" })
  if (draw < 20 / 35) return Object.freeze({ opening: "borobudur-mist", ending: "borobudur-noon" })
  if (draw < 21 / 35) return Object.freeze({ opening: "balloons-night", ending: "balloons-dawn" })
  if (draw < 22 / 35) return Object.freeze({ opening: "mekong-dawn", ending: "mekong-dusk" })
  if (draw < 23 / 35) return Object.freeze({ opening: "colosseum-day", ending: "colosseum-night" })
  if (draw < 24 / 35) return Object.freeze({ opening: "space-launch", ending: "space-drift" })
  if (draw < 25 / 35) return Object.freeze({ opening: "dungeon-descent", ending: "dungeon-treasure" })
  if (draw < 26 / 35) return Object.freeze({ opening: "castle-day", ending: "castle-night" })
  if (draw < 27 / 35) return Object.freeze({ opening: "islands-day", ending: "islands-dusk" })
  if (draw < 28 / 35) return Object.freeze({ opening: "jungle-day", ending: "jungle-night" })
  if (draw < 29 / 35) return Object.freeze({ opening: "reef-day", ending: "reef-night" })
  if (draw < 30 / 35) return Object.freeze({ opening: "pyramids-day", ending: "pyramids-night" })
  if (draw < 31 / 35) return Object.freeze({ opening: "aurora-night", ending: "aurora-dawn" })
  if (draw < 32 / 35) return Object.freeze({ opening: "lighthouse-day", ending: "lighthouse-night" })
  if (draw < 33 / 35) return Object.freeze({ opening: "falls-day", ending: "falls-moon" })
  if (draw < 34 / 35) return Object.freeze({ opening: "steppe-day", ending: "steppe-night" })
  return Object.freeze({ opening: "canyon-day", ending: "canyon-night" })
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
