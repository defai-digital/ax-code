export type AnimationPair = Readonly<{
  opening: "digital-code" | "classic-foliage" | "midnight-dream" | "fuji-day" | "mahjong-match"
  ending: "digital-code" | "golden-foliage" | "sunset-serenade" | "fuji-night" | "mahjong-ending"
}>

/** Choose once per TUI launch; previews and shutdown reuse the same pair. */
export function chooseAnimationPair(random: () => number = Math.random): AnimationPair {
  const draw = random()
  if (draw < 0.2) return Object.freeze({ opening: "digital-code", ending: "digital-code" })
  if (draw < 0.4) return Object.freeze({ opening: "classic-foliage", ending: "golden-foliage" })
  if (draw < 0.6) return Object.freeze({ opening: "midnight-dream", ending: "sunset-serenade" })
  if (draw < 0.8) return Object.freeze({ opening: "fuji-day", ending: "fuji-night" })
  return Object.freeze({ opening: "mahjong-match", ending: "mahjong-ending" })
}
