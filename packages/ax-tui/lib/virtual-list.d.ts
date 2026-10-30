export type VirtualListKey = string | number;
export interface VirtualListAnchor {
    key: VirtualListKey;
    index: number;
    offset: number;
}
/** Stable-key height index. Scroll lookup and individual measurements are O(log n). */
export declare class VirtualListModel<T> {
    private readonly getKey;
    private values;
    private keys;
    private indices;
    private heights;
    private tree;
    private measured;
    private total;
    readonly estimateHeight: number;
    constructor(getKey: (item: T) => VirtualListKey, estimateHeight?: number);
    get items(): readonly T[];
    get count(): number;
    get totalHeight(): number;
    setItems(items: readonly T[]): void;
    private rebuild;
    resetMeasurements(): void;
    keyAt(index: number): VirtualListKey | undefined;
    indexOf(key: VirtualListKey): number;
    heightAt(index: number): number;
    measure(index: number, height: number): boolean;
    offsetAt(index: number): number;
    indexAt(offset: number): number;
    range(scrollTop: number, viewportHeight: number, overscan?: number): {
        start: number;
        end: number;
    };
    anchor(scrollTop: number): VirtualListAnchor | undefined;
    resolveAnchor(anchor: VirtualListAnchor | undefined): number;
}
