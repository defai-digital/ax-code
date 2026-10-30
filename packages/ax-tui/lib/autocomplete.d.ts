/** Offsets are JavaScript UTF-16 indices, not terminal cells or native display-width offsets. */
export interface AutocompleteRequest {
    text: string;
    cursor: number;
}
export interface AutocompleteItem {
    label: string;
    insertText: string;
    /** Optional UTF-16 caret offset inside insertText (for example, before a closing quote). */
    cursorOffset?: number;
    description?: string;
}
export interface AutocompleteResult {
    /** The exact input snapshot for which these suggestions were computed. */
    request: AutocompleteRequest;
    start: number;
    end: number;
    items: readonly AutocompleteItem[];
}
export type AutocompleteProvider = (request: AutocompleteRequest, signal: AbortSignal) => AutocompleteResult | null | Promise<AutocompleteResult | null>;
/** Replace only the provider's token range, preserving the rest of the input. Reject stale results. */
export declare function applyAutocomplete(request: AutocompleteRequest, result: AutocompleteResult, item: AutocompleteItem): AutocompleteRequest | null;
/** Cancel superseded requests and ignore providers that resolve after cancellation. */
export declare class AutocompleteController {
    private readonly provider;
    private pending?;
    private disposed;
    constructor(provider: AutocompleteProvider);
    request(request: AutocompleteRequest): Promise<AutocompleteResult | null>;
    cancel(): void;
    dispose(): void;
}
export interface SlashCommand {
    name: string;
    description?: string;
}
/** Complete the leading slash-command token; command arguments belong to other providers. */
export declare function createSlashCommandProvider(commands: readonly SlashCommand[]): AutocompleteProvider;
export interface FilePathAutocompleteOptions {
    /** Resolved at provider creation, so later process.chdir calls cannot change the search base. */
    cwd?: string;
    home?: string;
    includeHidden?: boolean;
    maxResults?: number;
}
/**
 * Complete a whitespace-delimited path or @path. Double-quoted paths support spaces.
 * Backslashes are literal path characters (including Windows separators), not shell escapes.
 */
export declare function createFilePathProvider(options?: FilePathAutocompleteOptions): AutocompleteProvider;
/** First provider that recognizes the input wins, even when its item list is empty. */
export declare function combineAutocompleteProviders(...providers: AutocompleteProvider[]): AutocompleteProvider;
