import { EventEmitter } from "node:events";
import type { CliRenderer } from "../core/renderer.js";
import { Renderable } from "../core/renderable.js";
export interface CommandContext {
    readonly renderer: CliRenderer;
    readonly focused: Renderable | null;
}
export interface CommandDefinition {
    id: string;
    title: string;
    description?: string;
    keywords?: readonly string[];
    enabled?: (context: CommandContext) => boolean;
    run: (context: CommandContext) => void | Promise<void>;
}
export interface CommandMetadata {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly keywords: readonly string[];
    readonly enabled: boolean;
}
export type CommandResult = {
    status: "executed" | "not-found" | "disabled" | "stale-context" | "disposed";
} | {
    status: "error";
    error: unknown;
};
export declare function captureCommandContext(renderer: CliRenderer): CommandContext;
/** A separate execution registry; shortcut-help snapshots never provide command handlers. */
export declare class CommandRegistry extends EventEmitter<{
    change: [];
}> {
    readonly renderer: CliRenderer;
    private commands;
    private disposed;
    private constructor();
    static forRenderer(renderer: CliRenderer): CommandRegistry;
    register(command: CommandDefinition, target?: Renderable): () => void;
    private validContext;
    private enabled;
    search(query?: string, context?: CommandContext): readonly CommandMetadata[];
    execute(id: string, context?: CommandContext): Promise<CommandResult>;
    dispose: () => void;
}
export declare function getCommandRegistry(renderer: CliRenderer): CommandRegistry;
