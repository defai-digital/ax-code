export const textWidthGolden = [
  { text: "", widths: [0, 0, 0] },
  { text: "hello", widths: [5, 5, 5] },
  { text: "中文", widths: [4, 4, 4] },
  { text: "cafe\u0301", widths: [4, 4, 4] },
  { text: "\t", widths: [4, 4, 4] },
  { text: "a\tb", widths: [6, 6, 6] },
  { text: "\r\n", widths: [0, 0, 0] },
  { text: "👋🏿", widths: [2, 4, 2] },
  { text: "👩‍🚀", widths: [2, 4, 4] },
  { text: "Hello👩‍🚀World", widths: [12, 14, 14] },
  { text: "🇺🇸", widths: [2, 2, 2] },
] as const

export function textWidthCorpora() {
  return [
    { name: "ascii-short-1", texts: ["const result = value + 1"] },
    { name: "unicode-short-1", texts: ["中文 cafe\u0301 👩‍🚀 👋🏿 🇺🇸"] },
    { name: "ascii-lines-256", texts: Array.from({ length: 256 }, (_, i) => `ROW-${i} ${"source code ".repeat(8)}`) },
    {
      name: "unicode-lines-256",
      texts: Array.from({ length: 256 }, (_, i) => `ROW-${i} ${"中文 cafe\u0301 👩‍🚀 👋🏿 🇺🇸 ".repeat(4)}`),
    },
    {
      name: "unicode-document-64",
      texts: Array.from({ length: 64 }, (_, i) => `BLOCK-${i} ${"中文 cafe\u0301 👩‍🚀 👋🏿 🇺🇸 ".repeat(64)}`),
    },
  ]
}

export function randomWidthTexts(count = 1000, seed = 0xa871) {
  const units = ["a", " ", "\t", "\r\n", "中", "文", "e\u0301", "👩‍🚀", "👋🏿", "🇺🇸", "\u200d", "\ufe0f", "\u0000", "𝄞"]
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  return Array.from({ length: count }, () =>
    Array.from({ length: random() % 64 }, () => units[random() % units.length]).join(""),
  )
}
