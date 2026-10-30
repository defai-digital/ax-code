/**
 * SolidJS build and runtime integration for AX TUI.
 *
 * @module
 */
export {};
import { type RuntimeModuleEntry, type RuntimePluginRewriteOptions } from "@defai-digital/ax-tui/runtime-plugin";
export interface SolidRuntimePluginSupportOptions {
    additional?: Record<string, RuntimeModuleEntry>;
    core?: RuntimeModuleEntry;
    rewrite?: RuntimePluginRewriteOptions;
}
export declare function ensureRuntimePluginSupport(options?: SolidRuntimePluginSupportOptions): boolean;
