//! Output transport backends for `CliRenderer`.
//!
//! The renderer's render path writes ANSI bytes into an abstract writer
//! supplied by an `OutputBackend`. Two variants are available:
//!
//!   - `BufferedBackend`: writes into per-renderer A/B frame buffers, then
//!     flushes committed bytes to an injected `BufferedOutput`.
//!
//!   - `FeedBackend`: writes into a `NativeSpanFeed.Stream` whose chunks are
//!     consumed from TypeScript and piped to a user-supplied Writable
//!     (typically an SSH channel).
//!
//! The backend is a tagged union. `CliRenderer.render` performs exactly one
//! `switch` on the backend using `inline else` to pick the right variant's
//! writer type at compile time — keeping the render path generic over the
//! writer without scattering backend-specific switches across the codebase.

const std = @import("std");
const builtin = @import("builtin");
const Allocator = std.mem.Allocator;
const NativeSpanFeed = @import("native-span-feed.zig");

pub const OUTPUT_BUFFER_SIZE = 1024 * 1024 * 2; // 2 MiB, double-buffered per BufferedBackend for thread handoff

pub const WriteStatus = enum(u8) {
    ok = 0,
    skipped = 1,
    failed = 2,
};

pub const BufferedWriteFn = *const fn (ctx: *anyopaque, data: []const u8) void;

pub const BufferedOutput = struct {
    ctx: *anyopaque,
    write_fn: BufferedWriteFn,
    thread_safe: bool = false,

    pub fn write(self: BufferedOutput, data: []const u8) void {
        self.write_fn(self.ctx, data);
    }
};

/// Console code pages belong to the shared console, not an individual writer.
pub const ConsoleCodePageLease = struct {
    users: usize = 0,
    previous: u32 = 0,

    pub fn acquire(self: *ConsoleCodePageLease, api: anytype) bool {
        if (self.users == 0) {
            const previous = api.get();
            if (previous == 0 or !api.set(65001)) return false;
            self.previous = previous;
        }
        self.users += 1;
        return true;
    }

    pub fn release(self: *ConsoleCodePageLease, api: anytype) void {
        std.debug.assert(self.users > 0);
        self.users -= 1;
        if (self.users != 0) return;
        // A later external change must win over our saved console state.
        if (api.get() == 65001) _ = api.set(self.previous);
        self.previous = 0;
    }
};

var console_code_page_mutex: std.Thread.Mutex = .{};
var console_code_page_lease: ConsoleCodePageLease = .{};

const WindowsCodePageApi = struct {
    fn get(_: *@This()) u32 {
        return std.os.windows.kernel32.GetConsoleOutputCP();
    }

    fn set(_: *@This(), value: u32) bool {
        return std.os.windows.kernel32.SetConsoleOutputCP(value) != 0;
    }
};

pub const StdoutOutput = struct {
    stdoutBuffer: [4096]u8 = undefined,
    hasConsoleEncoding: bool = false,

    fn acquireConsoleEncoding(self: *StdoutOutput) void {
        if (builtin.os.tag != .windows) return;
        var mode: std.os.windows.DWORD = 0;
        // Redirected stdout, memory output and feeds must not alter the local console.
        if (std.os.windows.kernel32.GetConsoleMode(std.fs.File.stdout().handle, &mode) == 0) return;
        console_code_page_mutex.lock();
        defer console_code_page_mutex.unlock();
        var api: WindowsCodePageApi = .{};
        self.hasConsoleEncoding = console_code_page_lease.acquire(&api);
    }

    fn releaseConsoleEncoding(self: *StdoutOutput) void {
        if (builtin.os.tag != .windows or !self.hasConsoleEncoding) return;
        console_code_page_mutex.lock();
        defer console_code_page_mutex.unlock();
        var api: WindowsCodePageApi = .{};
        console_code_page_lease.release(&api);
        self.hasConsoleEncoding = false;
    }

    pub fn bufferedOutput(self: *StdoutOutput) BufferedOutput {
        return .{
            .ctx = self,
            .write_fn = write,
            .thread_safe = true,
        };
    }

    fn write(ctx: *anyopaque, data: []const u8) void {
        if (data.len == 0) return;

        const self: *StdoutOutput = @ptrCast(@alignCast(ctx));
        var stdoutWriter = std.fs.File.stdout().writer(&self.stdoutBuffer);
        const w = &stdoutWriter.interface;
        w.writeAll(data) catch {};
        w.flush() catch {};
    }
};

pub const MemoryOutput = struct {
    allocator: Allocator,
    bytes: std.ArrayListUnmanaged(u8) = .{},

    pub fn init(allocator: Allocator) MemoryOutput {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *MemoryOutput) void {
        self.bytes.deinit(self.allocator);
    }

    pub fn bufferedOutput(self: *MemoryOutput) BufferedOutput {
        return .{ .ctx = self, .write_fn = write };
    }

    fn write(ctx: *anyopaque, data: []const u8) void {
        const self: *MemoryOutput = @ptrCast(@alignCast(ctx));
        self.bytes.appendSlice(self.allocator, data) catch {};
    }
};

/// Tagged union dispatching to BufferedBackend or FeedBackend.
pub const OutputBackend = union(enum) {
    buffered: BufferedBackend,
    feed: FeedBackend,

    /// Synchronously emit a pre-built byte sequence (setup/shutdown/query).
    pub fn writeOut(self: *OutputBackend, data: []const u8) void {
        switch (self.*) {
            inline else => |*b| b.writeOut(data),
        }
    }

    /// Synchronously emit multiple pre-built byte sequences.
    pub fn writeOutMultiple(self: *OutputBackend, data_slices: []const []const u8) void {
        switch (self.*) {
            inline else => |*b| b.writeOutMultiple(data_slices),
        }
    }

    /// Prepare the backend for a new frame. Feed backends can return skipped
    /// when the durable queue is over its high-water mark or still owns pending
    /// bytes from an earlier frame.
    pub fn prepareFrame(self: *OutputBackend) WriteStatus {
        switch (self.*) {
            inline else => |*b| return b.prepareFrame(),
        }
    }

    /// Durably serialize a queued terminal control (Kitty APC bytes) starting
    /// at `offset`, advancing `offset` only by bytes the transport has
    /// accepted in order. Returns `.ok` only when `offset` reached the end of
    /// `data`; `.skipped` means the caller must retry later with the same
    /// data and offset. A partially written prefix is never replayed: feed
    /// bytes already copied into pending/reserved storage are tracked by the
    /// backend and finished on the next call.
    pub fn writeTerminalControl(self: *OutputBackend, data: []const u8, offset: *usize) WriteStatus {
        switch (self.*) {
            inline else => |*b| return b.writeTerminalControl(data, offset),
        }
    }

    /// Non-mutating high-water check. Rendering uses `prepareFrame()` so pending
    /// bytes from earlier writes can be committed before deciding to skip.
    pub fn shouldSkipFrame(self: *OutputBackend) bool {
        switch (self.*) {
            inline else => |*b| return b.shouldSkipFrame(),
        }
    }

    pub fn supportsThreading(self: *OutputBackend) bool {
        switch (self.*) {
            inline else => |*b| return b.supportsThreading(),
        }
    }

    pub fn setUseThread(self: *OutputBackend, use_thread: bool) void {
        switch (self.*) {
            inline else => |*b| b.setUseThread(use_thread),
        }
    }

    pub fn isUseThread(self: *OutputBackend) bool {
        switch (self.*) {
            inline else => |*b| return b.isUseThread(),
        }
    }

    /// Microseconds spent on the last write (populated after endFrame).
    pub fn getLastWriteTimeUs(self: *OutputBackend) ?f64 {
        switch (self.*) {
            inline else => |*b| return b.lastWriteTimeUs,
        }
    }

    /// Write a backend-specific debug dump into `out`. Called from the
    /// `dumpOutputBuffer` helper on `CliRenderer`; keeps backend-specific
    /// formatting internal so the renderer never switches on the tag.
    pub fn dumpTo(self: *OutputBackend, out: anytype) void {
        switch (self.*) {
            inline else => |*b| b.dumpTo(out),
        }
    }

    pub fn deinit(self: *OutputBackend, allocator: Allocator) void {
        switch (self.*) {
            inline else => |*b| b.deinit(allocator),
        }
    }
};

/// Backend that stages frame bytes in per-renderer buffers and flushes them to
/// an injected byte output when a frame is committed.
///
/// Owns the double buffers and optional render-thread state so each renderer
/// has isolated output storage.
pub const BufferedBackend = struct {
    const BufferId = enum { A, B };

    output: BufferedOutput,
    ownedStdoutOutput: ?*StdoutOutput = null,
    ownedMemoryOutput: ?*MemoryOutput = null,

    outputA: []u8,
    outputB: []u8,
    outputLenA: usize = 0,
    outputLenB: usize = 0,
    activeBuffer: BufferId = .A,
    lastCommittedBuffer: BufferId = .A,
    hasCommittedFrame: bool = false,

    useThread: bool = false,
    renderThread: ?std.Thread = null,
    renderMutex: std.Thread.Mutex = .{},
    renderCondition: std.Thread.Condition = .{},
    renderRequested: bool = false,
    shouldTerminate: bool = false,
    renderInProgress: bool = false,

    // Handoff buffer for the render thread
    currentOutputBuffer: []u8 = &[_]u8{},
    currentOutputLen: usize = 0,

    lastWriteTimeUs: ?f64 = null,

    pub fn create(allocator: Allocator, output: BufferedOutput) !BufferedBackend {
        const a_buf = try allocator.alloc(u8, OUTPUT_BUFFER_SIZE);
        errdefer allocator.free(a_buf);
        const b_buf = try allocator.alloc(u8, OUTPUT_BUFFER_SIZE);
        errdefer allocator.free(b_buf);

        return BufferedBackend{
            .output = output,
            .outputA = a_buf,
            .outputB = b_buf,
        };
    }

    pub fn createStdout(allocator: Allocator) !BufferedBackend {
        const stdoutOutput = try allocator.create(StdoutOutput);
        errdefer allocator.destroy(stdoutOutput);
        stdoutOutput.* = .{};
        stdoutOutput.acquireConsoleEncoding();
        errdefer stdoutOutput.releaseConsoleEncoding();

        var backend = try BufferedBackend.create(allocator, stdoutOutput.bufferedOutput());
        backend.ownedStdoutOutput = stdoutOutput;
        return backend;
    }

    pub fn createMemory(allocator: Allocator) !BufferedBackend {
        const memoryOutput = try allocator.create(MemoryOutput);
        errdefer allocator.destroy(memoryOutput);
        memoryOutput.* = MemoryOutput.init(allocator);

        var backend = try BufferedBackend.create(allocator, memoryOutput.bufferedOutput());
        backend.ownedMemoryOutput = memoryOutput;
        return backend;
    }

    pub fn deinit(self: *BufferedBackend, allocator: Allocator) void {
        if (self.renderThread) |thread| {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }
            self.shouldTerminate = true;
            // Do NOT set renderRequested — the thread should wake, see
            // shouldTerminate, and exit without a final spurious write of
            // the stale last-frame buffer. Previously setting renderRequested
            // here caused a stale frame to be emitted AFTER the shutdown
            // ANSI sequence had already restored the terminal.
            self.renderCondition.signal();
            self.renderMutex.unlock();
            thread.join();
            self.renderThread = null;
        }

        allocator.free(self.outputA);
        allocator.free(self.outputB);
        if (self.ownedStdoutOutput) |stdoutOutput| {
            stdoutOutput.releaseConsoleEncoding();
            allocator.destroy(stdoutOutput);
            self.ownedStdoutOutput = null;
        }
        if (self.ownedMemoryOutput) |memoryOutput| {
            memoryOutput.deinit();
            allocator.destroy(memoryOutput);
            self.ownedMemoryOutput = null;
        }
    }

    pub fn shouldSkipFrame(_: *BufferedBackend) bool {
        return false;
    }

    pub fn prepareFrame(_: *BufferedBackend) WriteStatus {
        return .ok;
    }

    pub fn supportsThreading(self: *BufferedBackend) bool {
        return self.output.thread_safe;
    }

    pub fn isUseThread(self: *BufferedBackend) bool {
        return self.useThread;
    }

    pub fn setUseThread(self: *BufferedBackend, use_thread: bool) void {
        if (use_thread and !self.supportsThreading()) return;
        if (self.useThread == use_thread) return;

        if (use_thread) {
            if (self.renderThread == null) {
                self.renderThread = std.Thread.spawn(.{}, renderThreadFn, .{self}) catch |err| {
                    std.log.warn("Failed to spawn render thread: {}, falling back to non-threaded mode", .{err});
                    self.useThread = false;
                    return;
                };
            }
        } else {
            if (self.renderThread) |thread| {
                self.renderMutex.lock();
                while (self.renderInProgress) {
                    self.renderCondition.wait(&self.renderMutex);
                }
                self.shouldTerminate = true;
                // Wake the thread with a terminate-only signal; do not set
                // renderRequested (that would replay the stale buffer).
                self.renderCondition.signal();
                self.renderMutex.unlock();

                thread.join();
                self.renderThread = null;
                self.shouldTerminate = false;
                // Reset request/progress flags so a future setUseThread(true)
                // does not wake on a stale request.
                self.renderRequested = false;
                self.renderInProgress = false;
            }
        }

        self.useThread = use_thread;
    }

    /// Frame-time writer context. A pointer to the backend so writes know
    /// which active buffer to append to.
    pub const WriterCtx = struct {
        backend: *BufferedBackend,
    };

    pub const Writer = std.io.GenericWriter(WriterCtx, error{BufferFull}, bufferWrite);

    fn bufferWrite(ctx: WriterCtx, data: []const u8) error{BufferFull}!usize {
        const self = ctx.backend;
        const bufferLen = if (self.activeBuffer == .A)
            &self.outputLenA
        else
            &self.outputLenB;
        const buffer = if (self.activeBuffer == .A)
            self.outputA
        else
            self.outputB;

        if (bufferLen.* + data.len > buffer.len) {
            return error.BufferFull;
        }

        @memcpy(buffer[bufferLen.*..][0..data.len], data);
        bufferLen.* += data.len;
        return data.len;
    }

    // TODO: std.io.GenericWriter is deprecated but the replacement is much more involved.
    // Migrate when the ecosystem stabilizes.
    pub fn writer(self: *BufferedBackend) Writer {
        return .{ .context = .{ .backend = self } };
    }

    pub fn beginFrame(self: *BufferedBackend) void {
        if (self.activeBuffer == .A) {
            self.outputLenA = 0;
        } else {
            self.outputLenB = 0;
        }
    }

    pub fn endFrame(self: *BufferedBackend) WriteStatus {
        const writeStart = std.time.microTimestamp();
        const committed_buffer = self.activeBuffer;

        if (self.useThread) {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }

            // Hand off the just-written buffer to the render thread and flip
            // active to the other one for the next frame.
            if (self.activeBuffer == .A) {
                self.activeBuffer = .B;
                self.currentOutputBuffer = self.outputA;
                self.currentOutputLen = self.outputLenA;
            } else {
                self.activeBuffer = .A;
                self.currentOutputBuffer = self.outputB;
                self.currentOutputLen = self.outputLenB;
            }

            self.renderRequested = true;
            self.renderInProgress = true;
            self.renderCondition.signal();
            self.renderMutex.unlock();
        } else {
            const to_write = if (self.activeBuffer == .A)
                self.outputA[0..self.outputLenA]
            else
                self.outputB[0..self.outputLenB];
            self.output.write(to_write);
            self.lastWriteTimeUs = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
        }

        self.lastCommittedBuffer = committed_buffer;
        self.hasCommittedFrame = true;
        return .ok;
    }

    fn renderThreadFn(self: *BufferedBackend) void {
        while (true) {
            self.renderMutex.lock();
            while (!self.renderRequested and !self.shouldTerminate) {
                self.renderCondition.wait(&self.renderMutex);
            }

            // Terminate wins: when shouldTerminate is set, exit without
            // writing even if a render was also requested. This keeps
            // shutdown-ANSI the last thing on the wire.
            if (self.shouldTerminate) {
                self.renderMutex.unlock();
                break;
            }

            self.renderRequested = false;

            const outputData = self.currentOutputBuffer;
            const outputLen = self.currentOutputLen;

            const writeStart = std.time.microTimestamp();

            self.output.write(outputData[0..outputLen]);

            self.lastWriteTimeUs = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
            self.renderInProgress = false;
            self.renderCondition.signal();
            self.renderMutex.unlock();
        }
    }

    pub fn writeOut(self: *BufferedBackend, data: []const u8) void {
        if (data.len == 0) return;

        if (self.useThread) {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }
            self.renderMutex.unlock();
        }

        self.output.write(data);
    }

    /// Emit the remaining control bytes as one external write so they cannot
    /// be split around a later frame. `writeOut` waits for any in-flight
    /// render-thread frame first, which keeps earlier frames before the
    /// control and the control before every frame handed off afterwards.
    /// The bytes go straight to the injected output; the 2 MiB frame scratch
    /// buffers are not used, so large uploads are not truncated by them.
    pub fn writeTerminalControl(self: *BufferedBackend, data: []const u8, offset: *usize) WriteStatus {
        if (offset.* >= data.len) return .ok;
        self.writeOut(data[offset.*..]);
        offset.* = data.len;
        return .ok;
    }

    pub fn writeOutMultiple(self: *BufferedBackend, data_slices: []const []const u8) void {
        if (self.useThread) {
            self.renderMutex.lock();
            while (self.renderInProgress) {
                self.renderCondition.wait(&self.renderMutex);
            }
            self.renderMutex.unlock();
        }

        var totalLen: usize = 0;
        for (data_slices) |slice| {
            totalLen += slice.len;
        }
        if (totalLen == 0) return;

        for (data_slices) |slice| {
            self.output.write(slice);
        }
    }

    /// Write a debug dump of the last rendered output into `out`. The
    /// committed-buffer marker is explicit because non-threaded rendering does
    /// not flip the active buffer after each frame.
    pub fn dumpTo(self: *BufferedBackend, out: anytype) void {
        const last = if (self.hasCommittedFrame) blk: {
            const buf = if (self.lastCommittedBuffer == .A) self.outputA else self.outputB;
            const len = if (self.lastCommittedBuffer == .A) self.outputLenA else self.outputLenB;
            break :blk buf[0..len];
        } else &.{};

        if (last.len > 0) {
            out.writeAll(last) catch return;
        } else {
            out.writeAll("(no output rendered yet)\n") catch return;
        }
        out.writeAll("\n================\n") catch return;
        out.print("Buffer size: {d} bytes\n", .{last.len}) catch return;
        const active_label: []const u8 = if (self.activeBuffer == .A) "A" else "B";
        const committed_label: []const u8 = if (self.lastCommittedBuffer == .A) "A" else "B";
        out.print("Active buffer: {s}\n", .{active_label}) catch return;
        out.print("Last committed buffer: {s}\n", .{committed_label}) catch return;
    }
};

/// Backend that writes to a `NativeSpanFeed.Stream`. The feed owns its own
/// chunk memory; we hold only a non-owning pointer. The TypeScript side is
/// responsible for allocating and destroying the feed; this backend simply
/// writes into it and commits on frame boundaries.
///
/// Feed writes are in-memory ring-buffer ops with no I/O, so threading adds
/// synchronization cost without latency-hiding benefit. Backpressure is
/// exposed through `prepareFrame`: when the span queue is at its high-water
/// mark, frames are skipped before diffing while already queued bytes remain
/// durable and drain in order.
///
/// Zig tests that want to exercise the feed path should drain the feed directly.
pub const FeedBackend = struct {
    feed: *NativeSpanFeed.Stream,

    /// Set when a frame's write to the feed fails. The backend never discards
    /// feed bytes; failures are reported so the renderer can force a later full
    /// repaint after the durable queue drains or accepts pending bytes.
    frameWriteFailed: bool = false,

    /// Length of one terminal-control segment already copied into the feed
    /// (active reservation or pending bytes) but not yet known to be
    /// committed as a span. The caller's queue offset stays at the start of
    /// this segment until the commit succeeds, so a retry finishes the
    /// segment instead of copying it a second time.
    controlInFeedLen: usize = 0,

    lastWriteTimeUs: ?f64 = null,

    pub fn create(feed: *NativeSpanFeed.Stream) FeedBackend {
        return FeedBackend{ .feed = feed };
    }

    pub fn deinit(_: *FeedBackend, _: Allocator) void {
        // Feed memory is owned by the TypeScript side. Nothing to free here.
    }

    pub fn shouldSkipFrame(self: *FeedBackend) bool {
        const stats = self.feed.getStats();
        const cap = self.feed.options.span_queue_capacity;
        return cap > 0 and stats.pending_spans >= cap;
    }

    pub fn prepareFrame(self: *FeedBackend) WriteStatus {
        self.frameWriteFailed = false;

        if (self.feed.hasPendingBytes()) {
            self.feed.commit() catch return .skipped;
            // Pending bytes belonged to an earlier frame/control write. Queue
            // them first and let the caller retry the new frame after drain.
            return .skipped;
        }

        if (self.shouldSkipFrame()) return .skipped;
        return .ok;
    }

    pub fn supportsThreading(_: *FeedBackend) bool {
        return false;
    }

    pub fn setUseThread(_: *FeedBackend, _: bool) void {
        // No-op: feed writes don't benefit from threading.
    }

    pub fn isUseThread(_: *FeedBackend) bool {
        return false;
    }

    pub const WriterCtx = struct {
        backend: *FeedBackend,
    };

    pub const Writer = std.io.GenericWriter(WriterCtx, error{BufferFull}, frameWrite);

    fn frameWrite(ctx: WriterCtx, data: []const u8) error{BufferFull}!usize {
        const self = ctx.backend;
        self.feed.write(data) catch {
            self.frameWriteFailed = true;
            return error.BufferFull;
        };
        return data.len;
    }

    pub fn writer(self: *FeedBackend) Writer {
        return .{ .context = .{ .backend = self } };
    }

    pub fn beginFrame(self: *FeedBackend) void {
        self.frameWriteFailed = false;
    }

    pub fn endFrame(self: *FeedBackend) WriteStatus {
        const writeStart = std.time.microTimestamp();
        var status: WriteStatus = .ok;

        if (self.frameWriteFailed) {
            if (self.feed.hasPendingBytes()) {
                self.feed.commit() catch {};
            }
            status = .failed;
        } else {
            self.feed.commit() catch {
                status = .failed;
            };
        }

        self.lastWriteTimeUs = @as(f64, @floatFromInt(std.time.microTimestamp() - writeStart));
        return status;
    }

    /// Copy control bytes into the feed one feed chunk at a time with
    /// reserve/commitReserved. `Stream.write` cannot be used here: with
    /// auto-commit enabled it commits chunk-sized prefixes and then fails
    /// mid-control, and with it disabled it rejects any write larger than
    /// the rest of the current chunk, so neither mode can stream a control
    /// larger than one feed chunk without loss or duplication.
    ///
    /// Progress rules:
    ///   - `offset` advances only after commitReserved/commit succeeds for
    ///     the segment starting at `offset`.
    ///   - If commitReserved fails after the copy, the segment survives as
    ///     pending bytes (or, when the failure happened before the
    ///     reservation was consumed, as the active reservation) and
    ///     `controlInFeedLen` records its length. The next call finishes
    ///     that exact segment; it never copies those bytes again.
    ///   - If the segment got committed outside this method (for example by
    ///     `prepareFrame` committing pending bytes), the reservation and
    ///     pending state are both clear while `controlInFeedLen` is still
    ///     set; the segment is then credited without a rewrite.
    ///   - Pending bytes that are not ours (earlier frames/external writes)
    ///     are committed first so stream order is preserved.
    pub fn writeTerminalControl(self: *FeedBackend, data: []const u8, offset: *usize) WriteStatus {
        if (offset.* >= data.len) return .ok;

        // A reservation left active by a failed commitReserved still holds
        // the copied segment. Finish it before reserving anything new.
        if (self.feed.reserved_active) {
            if (self.controlInFeedLen == 0) return .skipped;
            const segment_len = self.controlInFeedLen;
            self.feed.commitReserved(@intCast(segment_len)) catch return .skipped;
            self.controlInFeedLen = 0;
            offset.* += @min(segment_len, data.len - offset.*);
            if (offset.* >= data.len) return .ok;
        }

        // Segment committed elsewhere while we were not called: credit it.
        if (self.controlInFeedLen > 0 and self.feed.pending_len == 0) {
            const segment_len = self.controlInFeedLen;
            self.controlInFeedLen = 0;
            offset.* += @min(segment_len, data.len - offset.*);
            if (offset.* >= data.len) return .ok;
        }

        // Commit pending bytes first. They are either our copied segment or
        // bytes from earlier writes that must stay ahead of this control.
        if (self.feed.pending_len > 0) {
            const segment_len = self.controlInFeedLen;
            self.feed.commit() catch return .skipped;
            if (segment_len > 0) {
                self.controlInFeedLen = 0;
                offset.* += @min(segment_len, data.len - offset.*);
                if (offset.* >= data.len) return .ok;
            }
        }

        while (offset.* < data.len) {
            // Existing high-water backpressure: do not reserve/write while
            // the span ring is saturated, so a fixed-size ring blocks here
            // instead of dropping or truncating the control.
            if (self.shouldSkipFrame()) return .skipped;

            const reserved = self.feed.reserve(1) catch return .skipped;
            const dest = reserved.slice();
            if (dest.len == 0) {
                self.feed.commitReserved(0) catch {};
                return .skipped;
            }

            const segment_len = @min(dest.len, data.len - offset.*);
            @memcpy(dest[0..segment_len], data[offset.* .. offset.* + segment_len]);

            // Record before committing so a failed commit can be resumed
            // from feed state on the next call without recopying.
            self.controlInFeedLen = segment_len;
            self.feed.commitReserved(@intCast(segment_len)) catch return .skipped;
            self.controlInFeedLen = 0;
            offset.* += segment_len;
        }

        return .ok;
    }

    pub fn writeOut(self: *FeedBackend, data: []const u8) void {
        if (data.len == 0) return;
        self.feed.write(data) catch return;
        self.feed.commit() catch {};
    }

    pub fn writeOutMultiple(self: *FeedBackend, data_slices: []const []const u8) void {
        var totalLen: usize = 0;
        for (data_slices) |slice| totalLen += slice.len;
        if (totalLen == 0) return;

        var wrote_any = false;
        for (data_slices) |slice| {
            self.feed.write(slice) catch return;
            wrote_any = true;
        }
        if (wrote_any) self.feed.commit() catch {};
    }

    /// Write a debug dump placeholder. FeedBackend has no flat previous-frame
    /// slice — callers wanting feed bytes should drain the NativeSpanFeed.
    pub fn dumpTo(_: *FeedBackend, out: anytype) void {
        out.writeAll("(feed backend — drain spans from the NativeSpanFeed for output)\n") catch return;
        out.writeAll("\n================\n") catch return;
    }
};
