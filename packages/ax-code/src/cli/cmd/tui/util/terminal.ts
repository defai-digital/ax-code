import { RGBA } from "@opentui/core"

export namespace Terminal {
  export type Colors = Awaited<ReturnType<typeof colors>>
  /**
   * Query terminal colors including background, foreground, and palette (0-15).
   * Uses OSC escape sequences to retrieve actual terminal color values.
   *
   * Note: OSC 4 (palette) queries may not work through tmux as responses are filtered.
   * OSC 10/11 (foreground/background) typically work in most environments.
   *
   * Returns an object with background, foreground, and colors array.
   * Any query that fails will be null/empty.
   */
  export async function colors(): Promise<{
    background: RGBA | null
    foreground: RGBA | null
    colors: RGBA[]
  }> {
    if (!process.stdin.isTTY) return { background: null, foreground: null, colors: [] }

    return new Promise((resolve) => {
      let background: RGBA | null = null
      let foreground: RGBA | null = null
      const paletteColors: RGBA[] = []
      let timeout: NodeJS.Timeout
      const wasRaw = process.stdin.isRaw === true

      const cleanup = () => {
        process.stdin.removeListener("data", handler)
        process.stdin.setRawMode(wasRaw)
        clearTimeout(timeout)
      }

      const parseColor = (colorStr: string): RGBA | null => {
        // Validate parsed components before passing to RGBA.fromInts.
        // Previously malformed strings like `rgb:` or `rgb(,,)` produced
        // RGBA with NaN components (which coerce to 0, yielding valid
        // black) instead of null. The type signature says RGBA | null,
        // so callers expect null on failure.
        if (colorStr.startsWith("rgb:")) {
          const parts = colorStr.substring(4).split("/")
          if (parts.length !== 3) return null
          const rRaw = parseInt(parts[0], 16)
          const gRaw = parseInt(parts[1], 16)
          const bRaw = parseInt(parts[2], 16)
          if (!Number.isFinite(rRaw) || !Number.isFinite(gRaw) || !Number.isFinite(bRaw)) return null
          const r = rRaw >> 8
          const g = gRaw >> 8
          const b = bRaw >> 8
          return RGBA.fromInts(r, g, b, 255)
        }
        if (colorStr.startsWith("#")) {
          return RGBA.fromHex(colorStr)
        }
        if (colorStr.startsWith("rgb(")) {
          const parts = colorStr.substring(4, colorStr.length - 1).split(",")
          if (parts.length !== 3) return null
          const r = parseInt(parts[0], 10)
          const g = parseInt(parts[1], 10)
          const b = parseInt(parts[2], 10)
          if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
          return RGBA.fromInts(r, g, b, 255)
        }
        return null
      }

      const handler = (data: Buffer) => {
        const str = data.toString()

        // Match OSC 11 (background color)
        const bgMatch = str.match(/\x1b]11;([^\x07\x1b]+)/)
        if (bgMatch) {
          background = parseColor(bgMatch[1])
        }

        // Match OSC 10 (foreground color)
        const fgMatch = str.match(/\x1b]10;([^\x07\x1b]+)/)
        if (fgMatch) {
          foreground = parseColor(fgMatch[1])
        }

        // Match OSC 4 (palette colors)
        const paletteMatches = str.matchAll(/\x1b]4;(\d+);([^\x07\x1b]+)/g)
        for (const match of paletteMatches) {
          const index = parseInt(match[1], 10)
          if (index < 0 || index >= 16) continue
          const color = parseColor(match[2])
          if (color) paletteColors[index] = color
        }

        // Return immediately if we have all 16 palette colors
        if (paletteColors.filter((c) => c !== undefined).length === 16) {
          cleanup()
          resolve({ background, foreground, colors: paletteColors })
        }
      }

      process.stdin.setRawMode(true)
      process.stdin.on("data", handler)

      // Query background (OSC 11)
      process.stdout.write("\x1b]11;?\x07")
      // Query foreground (OSC 10)
      process.stdout.write("\x1b]10;?\x07")
      // Query palette colors 0-15 (OSC 4)
      for (let i = 0; i < 16; i++) {
        process.stdout.write(`\x1b]4;${i};?\x07`)
      }

      timeout = setTimeout(() => {
        cleanup()
        resolve({ background, foreground, colors: paletteColors })
      }, 1000)
    })
  }

  export async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
    const result = await colors()
    if (!result.background) return "dark"

    const { r, g, b } = result.background
    // Calculate luminance using relative luminance formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

    // Determine if dark or light based on luminance threshold
    return luminance > 0.5 ? "light" : "dark"
  }
}
