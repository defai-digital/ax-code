//! Evaluation-only, bounded batch ABI shared by native and WASM builds.
//! The production Unicode implementation is imported, never copied.
const std = @import("std");
const utf8 = @import("utf8");

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

// Status: 0 success, 1 invalid options/capacity, 2 invalid range, 3 invalid UTF-8.
// Validate the entire batch before publishing any result. All offsets are bytes.
export fn kernelMeasure(count: u32, byte_length: u32, tab_width: u32, method: u32) u32 {
    if (count > item_capacity or byte_length > byte_capacity or tab_width == 0 or tab_width > 255 or method > 2)
        return 1;
    for (0..count) |index| {
        const start = ranges[index * 2];
        const len = ranges[index * 2 + 1];
        if (start > byte_length or len > byte_length - start) return 2;
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
