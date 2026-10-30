const std = @import("std");
const lib = @import("../lib.zig");
const text_buffer = @import("../text-buffer.zig");
const audio = @import("../audio.zig");
const span = @import("../native-span-feed.zig");

const Field = struct {
    offset: u32,
    size: u32,
};

const Entry = struct {
    zig: []const u8,
    size: u32,
    alignment: u32,
    fields: []const Field,
};

const Contract = struct {
    pointerWidth: u32,
    structs: []const Entry,
};

fn expectLayout(comptime T: type, entry: Entry) !void {
    try std.testing.expectEqual(entry.size, @as(u32, @intCast(@sizeOf(T))));
    try std.testing.expectEqual(entry.alignment, @as(u32, @intCast(@alignOf(T))));
    const fields = std.meta.fields(T);
    try std.testing.expectEqual(entry.fields.len, fields.len);
    inline for (fields, 0..) |field, index| {
        const expected = entry.fields[index];
        try std.testing.expectEqual(expected.offset, @as(u32, @intCast(@offsetOf(T, field.name))));
        try std.testing.expectEqual(expected.size, @as(u32, @intCast(@sizeOf(field.type))));
    }
}

fn expectNamed(entry: Entry) !void {
    if (std.mem.eql(u8, entry.zig, "StyledChunk")) return expectLayout(text_buffer.StyledChunk, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalHighlight")) return expectLayout(lib.ExternalHighlight, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalLogicalCursor")) return expectLayout(lib.ExternalLogicalCursor, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalVisualCursor")) return expectLayout(lib.ExternalVisualCursor, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalCapabilities")) return expectLayout(lib.ExternalCapabilities, entry);
    if (std.mem.eql(u8, entry.zig, "EncodedChar")) return expectLayout(lib.EncodedChar, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalLineInfo")) return expectLayout(lib.ExternalLineInfo, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalMeasureResult")) return expectLayout(lib.ExternalMeasureResult, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalCursorState")) return expectLayout(lib.ExternalCursorState, entry);
    if (std.mem.eql(u8, entry.zig, "CursorStyleOptions")) return expectLayout(lib.CursorStyleOptions, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalGridDrawOptions")) return expectLayout(lib.ExternalGridDrawOptions, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalBuildOptions")) return expectLayout(lib.ExternalBuildOptions, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalAllocatorStats")) return expectLayout(lib.ExternalAllocatorStats, entry);
    if (std.mem.eql(u8, entry.zig, "ExternalRenderStats")) return expectLayout(lib.ExternalRenderStats, entry);
    if (std.mem.eql(u8, entry.zig, "NativeSpanFeedOptions")) return expectLayout(span.Options, entry);
    if (std.mem.eql(u8, entry.zig, "NativeSpanFeedStats")) return expectLayout(span.Stats, entry);
    if (std.mem.eql(u8, entry.zig, "SpanInfo")) return expectLayout(span.SpanInfo, entry);
    if (std.mem.eql(u8, entry.zig, "ReserveInfo")) return expectLayout(span.ReserveInfo, entry);
    if (std.mem.eql(u8, entry.zig, "AudioCreateOptions")) return expectLayout(audio.CreateOptions, entry);
    if (std.mem.eql(u8, entry.zig, "AudioStartOptions")) return expectLayout(audio.StartOptions, entry);
    if (std.mem.eql(u8, entry.zig, "AudioVoiceOptions")) return expectLayout(audio.VoiceOptions, entry);
    if (std.mem.eql(u8, entry.zig, "AudioStats")) return expectLayout(audio.Stats, entry);
    std.debug.print("No native extern struct for FFI layout {s}\n", .{entry.zig});
    return error.TestUnexpectedResult;
}

test "typescript FFI struct layouts match native extern structs" {
    try std.testing.expectEqual(@as(u32, 8), @as(u32, @intCast(@sizeOf(usize))));
    const parsed = try std.json.parseFromSlice(
        Contract,
        std.testing.allocator,
        @embedFile("../abi-layout.json"),
        .{ .ignore_unknown_fields = true },
    );
    defer parsed.deinit();
    try std.testing.expectEqual(@as(u32, 8), parsed.value.pointerWidth);
    try std.testing.expectEqual(@as(usize, 22), parsed.value.structs.len);
    for (parsed.value.structs) |entry| try expectNamed(entry);
}
