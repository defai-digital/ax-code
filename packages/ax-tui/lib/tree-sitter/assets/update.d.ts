#!/usr/bin/env bun
import { type PinnedGrammarQuery } from "../download-utils.js";
import type { FiletypeParserOptions } from "../types.js";
type QuerySource = string | PinnedGrammarQuery;
interface ParsersConfig {
    parsers: (Omit<FiletypeParserOptions, "queries"> & {
        queries: {
            highlights: QuerySource[];
            injections?: QuerySource[];
        };
    })[];
}
interface GeneratedParser {
    filetype: string;
    aliases?: string[];
    languagePath: string;
    highlightsPath: string;
    injectionsPath?: string;
    injectionMapping?: any;
}
export interface UpdateOptions {
    /** Path to parsers-config.json */
    configPath: string;
    /** Directory where .wasm and .scm files will be downloaded */
    assetsDir: string;
    /** Path where the generated TypeScript file will be written */
    outputPath: string;
}
export declare function getDefaultOptions(dirname?: string): UpdateOptions;
export declare function loadConfig(configPath: string): Promise<ParsersConfig>;
export declare function downloadLanguage(filetype: string, languageUrl: string, assetsDir: string, outputPath: string): Promise<string>;
export declare function downloadAndCombineQueries(filetype: string, sources: QuerySource[], assetsDir: string, outputPath: string, queryType: "highlights" | "injections", configPath: string): Promise<string>;
export declare function generateDefaultParsersFile(parsers: GeneratedParser[], outputPath: string): Promise<void>;
declare function main(options?: Partial<UpdateOptions>): Promise<void>;
export declare function runUpdateAssetsCli(): Promise<void>;
export { main as updateAssets };
