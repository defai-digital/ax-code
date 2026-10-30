import type { TextChunk } from "../core/text-buffer.js";
import type { SimpleHighlight } from "./tree-sitter/types.js";
export declare function detectLinks(chunks: TextChunk[], context: {
    content: string;
    highlights: SimpleHighlight[];
}): TextChunk[];
