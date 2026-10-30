import type { NativeTarget, NativeLibraryOptions, NativeLibraryPaths } from "./types.js";
export interface NativeManifestEntry {
    lib: {
        file: string;
        size: number;
        sha256: string;
    };
    licenseSha256: string;
}
export declare function isNativeTarget(value: string): value is NativeTarget;
export declare function nativeMetadata(packageRoot: string, target: NativeTarget): NativeManifestEntry;
export declare function nativeAssetNames(target: NativeTarget, entry: NativeManifestEntry): {
    library: string;
    license: string;
};
export declare function verifyNativeArtifacts(directory: string, entry: NativeManifestEntry): NativeLibraryPaths;
/** Internal injectable boundary; public callers use native/index.js. */
export declare function prepareNativeLibraryFrom(packageRoot: string, target: NativeTarget, options?: NativeLibraryOptions, fetchImpl?: typeof globalThis.fetch): Promise<NativeLibraryPaths>;
