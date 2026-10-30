import type { EditBufferRenderable } from "../renderables/EditBufferRenderable.js";
import { type AutocompleteItem, type AutocompleteRequest, type AutocompleteResult } from "./autocomplete.js";
/** Convert the native editor's display-width cursor to the provider's UTF-16 cursor. */
export declare function getEditorAutocompleteRequest(editor: EditBufferRenderable): AutocompleteRequest;
/** Apply a current suggestion as one undoable edit using the renderer's own Unicode width rules. */
export declare function applyEditorAutocomplete(editor: EditBufferRenderable, result: AutocompleteResult, item: AutocompleteItem): boolean;
