const std = @import("std");
const text_buffer = @import("../text-buffer.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const utf8 = @import("../utf8.zig");

const TextBuffer = text_buffer.UnifiedTextBuffer;
const StyleSpan = text_buffer.StyleSpan;
const Range = struct { start: u32, end: u32, style: u32, priority: u8 };

fn appendRanges(tb: *TextBuffer, ranges: []const Range) !void {
    tb.startHighlightsTransaction();
    defer tb.endHighlightsTransaction();
    for (ranges, 0..) |range, index| {
        try tb.addHighlight(0, range.start, range.end, range.style, range.priority, @intCast(index + 1));
    }
}

// Partition at every highlight boundary and independently choose the highest
// priority style. Test overlaps use distinct priorities, so no tie policy is
// imposed on the existing generic sweep. Equal adjacent styles stay separate.
fn expectSpansMatchBoundaries(tb: *TextBuffer) !void {
    const highlights = tb.getLineHighlights(0);
    if (highlights.len == 0) {
        try std.testing.expectEqual(@as(usize, 0), tb.getLineSpans(0).len);
        return;
    }
    var boundaries: std.ArrayListUnmanaged(u32) = .{};
    defer boundaries.deinit(std.testing.allocator);
    try boundaries.append(std.testing.allocator, 0);
    for (highlights) |highlight| {
        try boundaries.append(std.testing.allocator, highlight.col_start);
        try boundaries.append(std.testing.allocator, highlight.col_end);
    }
    std.mem.sort(u32, boundaries.items, {}, std.sort.asc(u32));
    const width = tb.lineWidthAt(0);
    if (width > boundaries.items[boundaries.items.len - 1]) try boundaries.append(std.testing.allocator, width);
    var expected: std.ArrayListUnmanaged(StyleSpan) = .{};
    defer expected.deinit(std.testing.allocator);
    var start: u32 = 0;
    for (boundaries.items) |end| {
        if (end == start) continue;
        var priority: i16 = -1;
        var style: u32 = 0;
        for (highlights) |highlight| {
            if (highlight.col_start <= start and highlight.col_end >= end and highlight.priority > priority) {
                priority = highlight.priority;
                style = highlight.style_id;
            }
        }
        try expected.append(std.testing.allocator, .{ .col = start, .next_col = end, .style_id = style });
        start = end;
    }
    try std.testing.expectEqualDeep(@as([]const StyleSpan, expected.items), tb.getLineSpans(0));
}

test "TextBuffer span rebuild preserves ordered boundaries, gaps and out-of-line ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const cases = [_][]const Range{
        &.{},
        &.{.{ .start = 2, .end = 5, .style = 1, .priority = 3 }},
        &.{
            .{ .start = 0, .end = 3, .style = 1, .priority = 3 },
            .{ .start = 3, .end = 5, .style = 1, .priority = 0 },
            .{ .start = 7, .end = 10, .style = 2, .priority = 5 },
            .{ .start = 17, .end = 24, .style = 3, .priority = 1 },
        },
        &.{
            .{ .start = 1, .end = 2, .style = 0, .priority = 0 },
            .{ .start = std.math.maxInt(u32) - 1, .end = std.math.maxInt(u32), .style = 7, .priority = 1 },
        },
        // An unordered disjoint input and an overlapping input must use the
        // generic sweep and preserve priority and sorted output boundaries.
        &.{
            .{ .start = 8, .end = 12, .style = 1, .priority = 2 },
            .{ .start = 0, .end = 5, .style = 2, .priority = 1 },
        },
        &.{
            .{ .start = 0, .end = 15, .style = 1, .priority = 1 },
            .{ .start = 3, .end = 7, .style = 2, .priority = 9 },
            .{ .start = 5, .end = 10, .style = 3, .priority = 4 },
        },
    };
    for ([_]utf8.WidthMethod{ .unicode, .wcwidth, .no_zwj }) |method| {
        const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, method);
        defer tb.deinit();
        for ([_][]const u8{ "0123456789abcdefghij", "中 cafe\u{301} 👩‍💻\t", "" }) |text| {
            try tb.setText(text);
            for (cases) |ranges| {
                tb.clearAllHighlights();
                try appendRanges(tb, ranges);
                try expectSpansMatchBoundaries(tb);
            }
        }
    }
}

test "TextBuffer span rebuild switches between ordered and overlapping highlights after removal" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("0123456789abcdefghij");
    const ranges = [_]Range{
        .{ .start = 0, .end = 5, .style = 1, .priority = 1 },
        .{ .start = 5, .end = 9, .style = 2, .priority = 2 },
        .{ .start = 11, .end = 15, .style = 3, .priority = 3 },
    };
    for (0..4) |_| {
        tb.clearAllHighlights();
        try appendRanges(tb, &ranges);
        try expectSpansMatchBoundaries(tb);
        try tb.addHighlight(0, 2, 14, 9, 99, 100);
        try expectSpansMatchBoundaries(tb);
        tb.removeHighlightsByRef(100);
        try expectSpansMatchBoundaries(tb);
        tb.removeHighlightsByRef(2);
        try expectSpansMatchBoundaries(tb);
    }
}

test "TextBuffer span rebuild matches boundary oracle for seeded ordered and overlapping ranges" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("0123456789abcdefghij");
    var prng = std.Random.DefaultPrng.init(0x5a871);
    const random = prng.random();
    var ranges: [24]Range = undefined;
    for (0..400) |iteration| {
        var cursor: u32 = 0;
        for (&ranges, 0..) |*range, index| {
            const start = if (iteration % 2 == 0) cursor + random.uintLessThan(u32, 3) else random.uintLessThan(u32, 24);
            const end = start + 1 + random.uintLessThan(u32, 5);
            range.* = .{ .start = start, .end = end, .style = @intCast(index + 1), .priority = @intCast(index + 1) };
            cursor = end;
        }
        tb.clearAllHighlights();
        try appendRanges(tb, &ranges);
        try expectSpansMatchBoundaries(tb);
    }
}

test "TextBuffer span rebuild needs no temporary allocations for warmed ordered highlights" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const tb = try TextBuffer.init(std.testing.allocator, pool, link_pool, .unicode);
    defer tb.deinit();
    try tb.setText("0123456789abcdefghij");
    const ranges = [_]Range{
        .{ .start = 1, .end = 5, .style = 1, .priority = 1 },
        .{ .start = 5, .end = 9, .style = 1, .priority = 1 },
        .{ .start = 11, .end = 15, .style = 3, .priority = 3 },
    };
    try appendRanges(tb, &ranges);
    tb.clearAllHighlights();
    tb.startHighlightsTransaction();
    try appendRanges(tb, &ranges); // Inner transaction leaves the rebuild queued.
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0, .resize_fail_index = 0 });
    const original_allocator = tb.global_allocator;
    tb.global_allocator = failing.allocator();
    tb.endHighlightsTransaction();
    tb.global_allocator = original_allocator;
    try std.testing.expect(!failing.has_induced_failure);
    try expectSpansMatchBoundaries(tb);
}
