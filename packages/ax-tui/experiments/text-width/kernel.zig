//! Evaluation-only, bounded batch ABI shared by native and WASM builds.
//! The production Unicode implementation is imported, never copied.
const std = @import("std");
const utf8 = @import("utf8");
const uucode = @import("uucode");

const byte_capacity = 1024 * 1024;
const item_capacity = 4096;
var input: [byte_capacity]u8 = undefined;
var ranges: [item_capacity * 2]u32 = undefined;
var widths: [item_capacity]u32 = undefined;

export fn kernelAbiVersion() u32 {
    return 1;
}

export fn kernelByteCapacity() u32 {
    return byte_capacity;
}

export fn kernelItemCapacity() u32 {
    return item_capacity;
}

export fn kernelInput() [*]u8 {
    return &input;
}

export fn kernelRanges() [*]u32 {
    return &ranges;
}

export fn kernelWidths() [*]u32 {
    return &widths;
}

// Exports for regenerating the Rust pilot's frozen Unicode compatibility data.
// These encode the renderer's policy, including its terminal-specific widths.
export fn kernelGraphemeClassCount() u32 {
    return @typeInfo(uucode.types.GraphemeBreak).@"enum".fields.len;
}

export fn kernelGraphemeStateCount() u32 {
    return @typeInfo(uucode.grapheme.BreakState).@"enum".fields.len;
}

export fn kernelScalarProperties(cp: u32) u32 {
    if (cp > 0x10FFFF) return 0;
    const codepoint: u21 = @intCast(cp);
    const grapheme: u32 = @intFromEnum(uucode.get(.grapheme_break, codepoint));
    const mark: u32 = @intFromBool(uucode.get(.general_category, codepoint) == .mark_nonspacing);
    return grapheme | (utf8.eastAsianWidth(codepoint) << 5) | (mark << 7);
}

export fn kernelGraphemeTransition(previous: u32, current: u32, state: u32) u32 {
    if (previous >= kernelGraphemeClassCount() or current >= kernelGraphemeClassCount() or
        state >= kernelGraphemeStateCount()) return 0;
    var next: uucode.grapheme.BreakState = @enumFromInt(state);
    const boundary = uucode.grapheme.precomputedGraphemeBreak(@enumFromInt(previous), @enumFromInt(current), &next);
    return @as(u32, @intFromEnum(next)) | (@as(u32, @intFromBool(boundary)) << 7);
}

// Status: 0 success, 1 invalid options/capacity, 2 invalid range, 3 invalid UTF-8,
// 4 total range length exceeds the work budget, including overlapping ranges.
// Validate the entire batch before publishing any result. All offsets are bytes.
export fn kernelMeasure(count: u32, byte_length: u32, tab_width: u32, method: u32) u32 {
    if (count > item_capacity or byte_length > byte_capacity or tab_width == 0 or tab_width > 255 or method > 2)
        return 1;
    var bytes_remaining: u32 = byte_capacity;
    for (0..count) |index| {
        const start = ranges[index * 2];
        const len = ranges[index * 2 + 1];
        if (start > byte_length or len > byte_length - start) return 2;
        if (len > bytes_remaining) return 4;
        bytes_remaining -= len;
        if (!std.unicode.utf8ValidateSlice(input[start..][0..len])) return 3;
    }
    const width_method: utf8.WidthMethod = switch (method) {
        0 => .unicode,
        1 => .wcwidth,
        2 => .no_zwj,
        else => unreachable,
    };
    for (0..count) |index| {
        const text = input[ranges[index * 2]..][0..ranges[index * 2 + 1]];
        widths[index] = utf8.calculateTextWidth(text, @intCast(tab_width), utf8.isAsciiOnly(text), width_method);
    }
    return 0;
}
