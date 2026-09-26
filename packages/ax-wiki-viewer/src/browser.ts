import { mount } from "./index.js"
// The exporter supplies an escaped data literal in this same script, not HTML.
declare const AX_WIKI_GRAPH: unknown
const container = document.getElementById("wiki-viewer")!
try {
  mount(container, AX_WIKI_GRAPH)
} catch {
  container.textContent = "This Wiki snapshot is invalid or incompatible with the viewer."
}
