/**
 * SolidJS reconciler and component lifecycle for AX TUI.
 *
 * @module
 */
export {};
import { CliRenderer, type CliRendererConfig } from "@defai-digital/ax-tui";
import { type TestRendererOptions } from "@defai-digital/ax-tui/testing";
import type { JSX } from "./jsx-runtime.js";
export declare const render: (node: () => JSX.Element, rendererOrConfig?: CliRenderer | CliRendererConfig) => Promise<void>;
export declare const testRender: (node: () => JSX.Element, renderConfig?: TestRendererOptions) => Promise<import("@defai-digital/ax-tui/testing").TestRendererSetup>;
export * from "./src/reconciler.js";
export * from "./src/elements/index.js";
export * from "./src/scrollback.js";
export * from "./src/time-to-first-draw.js";
export * from "./src/plugins/slot.js";
export * from "./src/types/elements.js";
export { type JSX };
