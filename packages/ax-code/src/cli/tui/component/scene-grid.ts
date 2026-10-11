import type { FujiRun } from "./fuji-view-model"

/**
 * Character-cell grid plumbing shared by the scene view-models: a sky-filled
 * grid centered on the scene's fixed composition, a bounds-checked `paint`
 * that writes a text run in scene coordinates, and `merge` collapsing
 * adjacent same-color cells into FujiRun rows.
 */
export function createSceneGrid(input: {
  columns: number
  rows: number
  sceneColumns: number
  sceneRows: number
  sky: string
}) {
  const width = Math.max(0, Math.floor(input.columns))
  const height = Math.max(0, Math.floor(input.rows))
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: input.sky })),
  )
  const left = Math.floor((width - input.sceneColumns) / 2)
  const top = Math.floor((height - input.sceneRows) / 2)

  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= input.sceneColumns || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }

  const merge = () =>
    grid.map((row) => {
      const runs: FujiRun[] = []
      for (const cell of row) {
        const last = runs.at(-1)
        if (last?.color === cell.color && last.background === cell.background) last.text += cell.text
        else runs.push({ ...cell })
      }
      return runs
    })

  return { grid, paint, merge, width, height, left, top }
}
