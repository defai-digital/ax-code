import { TextBuffer } from "../core/text-buffer.js"
import type { EditBufferRenderable } from "../renderables/EditBufferRenderable.js"
import { InputRenderable } from "../renderables/Input.js"
import {
  applyAutocomplete,
  type AutocompleteItem,
  type AutocompleteRequest,
  type AutocompleteResult,
} from "./autocomplete.js"

/** Convert the native editor's display-width cursor to the provider's UTF-16 cursor. */
export function getEditorAutocompleteRequest(editor: EditBufferRenderable): AutocompleteRequest {
  return { text: editor.plainText, cursor: editor.editBuffer.getTextRange(0, editor.cursorOffset).length }
}

/** Apply a current suggestion as one undoable edit using the renderer's own Unicode width rules. */
export function applyEditorAutocomplete(
  editor: EditBufferRenderable,
  result: AutocompleteResult,
  item: AutocompleteItem,
): boolean {
  if (editor.isDestroyed || editor.hasSelection()) return false
  const replacement = applyAutocomplete(getEditorAutocompleteRequest(editor), result, item)
  if (!replacement) return false
  const prefix = replacement.text.slice(0, replacement.cursor)
  const measurement = TextBuffer.create(editor.ctx.widthMethod)
  try {
    // Apply the caret before input callbacks can make a newer edit or destroy the editor.
    // The native cursor clamps to the resulting buffer if InputRenderable truncates the text.
    measurement.setText(editor instanceof InputRenderable ? prefix.replace(/[\n\r]/g, "") : prefix)
    editor.replaceText(replacement.text, measurement.length + measurement.getLineCount() - 1)
  } finally {
    measurement.destroy()
  }
  return true
}
