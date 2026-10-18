import { isRenderable, RenderableEvents } from "ax-tui"
import { createRoot, type JSX, type Owner } from "solid-js"

export const DIALOG_SELECT_VIRTUAL_THRESHOLD = 100

/** A native virtual row owns its Solid effects until the native row is retired. */
export function solidVirtualRow(owner: Owner | null, render: () => JSX.Element) {
  return createRoot((dispose) => {
    try {
      const row = render()
      if (!isRenderable(row)) throw new Error("A dialog virtual row must render one native node")
      row.once(RenderableEvents.DESTROYED, dispose)
      return row
    } catch (error) {
      dispose()
      throw error
    }
  }, owner)
}

/** Object identity is bounded by GC; primitive keys survive reactive option copies. */
export function createDialogOptionKey() {
  const objects = new WeakMap<object, number>()
  let serial = 0
  return (value: unknown): string => {
    if ((typeof value === "object" && value !== null) || typeof value === "function") {
      if ("id" in value && (typeof value.id === "string" || typeof value.id === "number")) {
        return JSON.stringify(["id", value.id])
      }
      let id = objects.get(value)
      if (id === undefined) objects.set(value, (id = ++serial))
      return `object:${id}`
    }
    return JSON.stringify([typeof value, String(value)])
  }
}
