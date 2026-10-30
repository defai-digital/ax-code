import { BAR_EMPTY, symbolForHeight } from "./symbols.js";
/**
 * Sparkline layout (faithful port of ratatui `render_sparkline`).
 *
 * Integer tick scaling: one cell holds 8 ticks; a bar consumes ticks
 * bottom-up so multi-row sparklines stack seamlessly with bottom-aligned
 * eighth blocks. `max <= 0` renders empty bars (no division by zero).
 */
export function layoutSparkline(options, width, height) {
    if (width <= 0 || height <= 0)
        return [];
    const cells = [];
    const data = options.data;
    if (options.backgroundColor !== undefined) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++)
                cells.push({ x, y, char: BAR_EMPTY, bg: options.backgroundColor });
        }
    }
    let max;
    if (options.max !== undefined && Number.isFinite(options.max)) {
        max = options.max;
    }
    else {
        let computed = Number.NEGATIVE_INFINITY;
        for (const value of data) {
            if (typeof value === "number" && Number.isFinite(value) && value > computed)
                computed = value;
        }
        max = Number.isFinite(computed) ? computed : 1;
    }
    const maxTicks = height * 8;
    const count = Math.min(width, data.length);
    for (let i = 0; i < count; i++) {
        const x = options.direction === "rtl" ? width - 1 - i : i;
        const value = data[i];
        const missing = typeof value !== "number" || !Number.isFinite(value);
        let ticks = 0;
        if (!missing && max > 0) {
            ticks = Math.min(Math.floor((Math.max(value, 0) * maxTicks) / max), maxTicks);
        }
        const fg = missing ? undefined : options.barColor ? options.barColor(value, i) : options.color;
        for (let row = height - 1; row >= 0; row--) {
            const char = missing ? BAR_EMPTY : symbolForHeight(ticks);
            if (!missing || options.backgroundColor !== undefined) {
                cells.push({ x, y: row, char, fg, bg: options.backgroundColor });
            }
            if (!missing)
                ticks = ticks > 8 ? ticks - 8 : 0;
        }
    }
    return cells;
}
