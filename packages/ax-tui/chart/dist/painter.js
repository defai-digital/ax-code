function validBounds(bounds) {
    return [...bounds.x, ...bounds.y].every(Number.isFinite) && bounds.x[0] < bounds.x[1] && bounds.y[0] < bounds.y[1];
}
// Divide before scaling to pixels. Halving first also handles finite endpoints
// whose difference exceeds Number.MAX_VALUE.
function fraction(value, start, end) {
    if (value === start)
        return 0;
    const span = end - start;
    return Number.isFinite(span) ? (value - start) / span : (value / 2 - start / 2) / (end / 2 - start / 2);
}
function interpolate(start, end, ratio) {
    return start * (1 - ratio) + end * ratio;
}
/**
 * World-to-pixel mapping (faithful port of ratatui `Painter::get_point`).
 *
 * The world origin is bottom-left (mathematical coordinates); the pixel
 * origin is top-left. Returns null for non-finite input, points outside the
 * bounds, and degenerate/reversed bounds (min >= max) — ratatui draws
 * nothing in those cases and never throws.
 */
export function getPoint(wx, wy, bounds, resolution) {
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !validBounds(bounds))
        return null;
    if (!Number.isSafeInteger(resolution.x) || !Number.isSafeInteger(resolution.y))
        return null;
    if (resolution.x <= 0 || resolution.y <= 0)
        return null;
    const [left, right] = bounds.x;
    const [bottom, top] = bounds.y;
    if (wx < left || wx > right || wy < bottom || wy > top)
        return null;
    return {
        px: Math.round(fraction(wx, left, right) * (resolution.x - 1)),
        py: Math.round(fraction(wy, top, bottom) * (resolution.y - 1)),
    };
}
const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
const BOTTOM = 4;
const TOP = 8;
function outcode(x, y, bounds) {
    const [left, right] = bounds.x;
    const [bottom, top] = bounds.y;
    let code = INSIDE;
    if (x < left)
        code |= LEFT;
    else if (x > right)
        code |= RIGHT;
    if (y < bottom)
        code |= BOTTOM;
    else if (y > top)
        code |= TOP;
    return code;
}
/**
 * Cohen-Sutherland clipping of a world-space segment against the bounds
 * (ratatui clips chart lines with the `line_clipping` crate before
 * projecting). Returns the clipped segment, or null when fully outside or
 * when any coordinate is non-finite.
 */
export function clipLine(x1, y1, x2, y2, bounds) {
    if (![x1, y1, x2, y2].every(Number.isFinite) || !validBounds(bounds))
        return null;
    const [left, right] = bounds.x;
    const [bottom, top] = bounds.y;
    let out1 = outcode(x1, y1, bounds);
    let out2 = outcode(x2, y2, bounds);
    for (;;) {
        if ((out1 | out2) === INSIDE)
            return [x1, y1, x2, y2];
        if ((out1 & out2) !== INSIDE)
            return null;
        const out = out1 !== INSIDE ? out1 : out2;
        let x = 0;
        let y = 0;
        if ((out & TOP) !== 0) {
            x = interpolate(x1, x2, fraction(top, y1, y2));
            y = top;
        }
        else if ((out & BOTTOM) !== 0) {
            x = interpolate(x1, x2, fraction(bottom, y1, y2));
            y = bottom;
        }
        else if ((out & RIGHT) !== 0) {
            y = interpolate(y1, y2, fraction(right, x1, x2));
            x = right;
        }
        else {
            y = interpolate(y1, y2, fraction(left, x1, x2));
            x = left;
        }
        if (out === out1) {
            x1 = x;
            y1 = y;
            out1 = outcode(x1, y1, bounds);
        }
        else {
            x2 = x;
            y2 = y;
            out2 = outcode(x2, y2, bounds);
        }
    }
}
/**
 * Integer Bresenham over pixel space (port of ratatui `for_each_line_point`;
 * the all-octant error-doubling variant produces the same rasterization).
 * Chart line interpolation projects the clipped endpoints first and then
 * rasterizes — never float-step between data points. Invalid or unsafe integer
 * coordinates are ignored so an unreachable endpoint cannot trap the loop.
 */
export function forEachLinePoint(x0, y0, x1, y1, paint) {
    if (![x0, y0, x1, y1, x1 - x0, y1 - y0].every(Number.isSafeInteger))
        return;
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
        paint(x, y);
        if (x === x1 && y === y1)
            break;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
    }
}
/** Clip, project, and rasterize one world-space segment onto a grid. */
export function strokeSegment(ax, ay, bx, by, bounds, grid, paint) {
    const clipped = clipLine(ax, ay, bx, by, bounds);
    if (!clipped)
        return;
    const p0 = getPoint(clipped[0], clipped[1], bounds, grid.resolution);
    const p1 = getPoint(clipped[2], clipped[3], bounds, grid.resolution);
    if (!p0 || !p1)
        return;
    forEachLinePoint(p0.px, p0.py, p1.px, p1.py, paint);
}
