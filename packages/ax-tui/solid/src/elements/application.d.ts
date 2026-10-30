import { type CommandDefinition, type CommandPaletteHandle, type CommandPaletteOptions, type FocusScopeOptions, type Renderable } from "@defai-digital/ax-tui";
export declare function useFocusManager(): {
    registerScope(root: Renderable, options?: FocusScopeOptions): () => void;
    focusNext: () => boolean;
    focusPrevious: () => boolean;
};
export declare function useCommands(): {
    register(command: CommandDefinition, target?: Renderable): () => void;
    execute: (id: string, context?: import("@defai-digital/ax-tui").CommandContext) => Promise<import("@defai-digital/ax-tui").CommandResult>;
    search: (query?: string, context?: import("@defai-digital/ax-tui").CommandContext) => readonly import("@defai-digital/ax-tui").CommandMetadata[];
};
export declare function useCommandPalette(): {
    show(options?: CommandPaletteOptions): CommandPaletteHandle;
};
