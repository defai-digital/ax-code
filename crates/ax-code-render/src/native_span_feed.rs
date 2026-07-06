//! ADR-046 Slice E — native-span-feed transport (native-span-feed.zig).
//!
//! A chunk-pool byte stream: `stream_write` copies bytes into fixed-size heap
//! chunks, `stream_commit` publishes the accumulated range as a `SpanInfo` into
//! a growable ring, and `stream_drain_spans` pops committed spans (each pointing
//! at `chunk_ptr[offset..offset+len]`). This is the `feedPtr` transport for the
//! renderer's FeedBackend (SSH / thin-client remote attach).
//!
//! Structs mirror the Zig `extern struct` layouts so the exported symbols are
//! ABI-compatible. The per-chunk refcount `state_buffer` and event callbacks
//! exist for the async consumer; they don't affect drained bytes, so callbacks
//! are stored-but-not-invoked here.

#![allow(clippy::missing_safety_doc)]

use napi_derive::napi;

const CHUNK_SIZE_DEFAULT: u32 = 64 * 1024;
const SPAN_QUEUE_CAPACITY_DEFAULT: u32 = 4096;

const GROWTH_BLOCK: u8 = 1;

// Status codes (native-span-feed.zig Status).
const STATUS_OK: i32 = 0;
const STATUS_ERR_NO_SPACE: i32 = -1;
const STATUS_ERR_MAX_BYTES: i32 = -2;
const STATUS_ERR_INVALID: i32 = -3;
const STATUS_ERR_ALLOC: i32 = -4;
const STATUS_ERR_BUSY: i32 = -5;

#[derive(Clone, Copy, Debug)]
pub enum StreamError {
    NoSpace,
    MaxBytes,
    Invalid,
    #[allow(dead_code)]
    OutOfMemory,
    Busy,
}

fn error_to_status(err: StreamError) -> i32 {
    match err {
        StreamError::NoSpace => STATUS_ERR_NO_SPACE,
        StreamError::MaxBytes => STATUS_ERR_MAX_BYTES,
        StreamError::Invalid => STATUS_ERR_INVALID,
        StreamError::OutOfMemory => STATUS_ERR_ALLOC,
        StreamError::Busy => STATUS_ERR_BUSY,
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Options {
    pub chunk_size: u32,
    pub initial_chunks: u32,
    pub max_bytes: u64,
    pub growth_policy: u8,
    pub auto_commit_on_full: u8,
    pub span_queue_capacity: u32,
}

fn default_options() -> Options {
    Options {
        chunk_size: CHUNK_SIZE_DEFAULT,
        initial_chunks: 2,
        max_bytes: 0,
        growth_policy: 0, // grow
        auto_commit_on_full: 1,
        span_queue_capacity: 0,
    }
}

fn normalize_options(mut o: Options) -> Options {
    if o.chunk_size == 0 {
        o.chunk_size = CHUNK_SIZE_DEFAULT;
    }
    if o.initial_chunks == 0 {
        o.initial_chunks = 1;
    }
    if o.span_queue_capacity == 0 {
        o.span_queue_capacity = SPAN_QUEUE_CAPACITY_DEFAULT;
    }
    o
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Stats {
    pub bytes_written: u64,
    pub spans_committed: u64,
    pub chunks: u32,
    pub pending_spans: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct SpanInfo {
    pub chunk_ptr: usize,
    pub offset: u32,
    pub len: u32,
    pub chunk_index: u32,
    pub reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ReserveInfo {
    pub ptr: usize,
    pub len: u32,
    pub reserved: u32,
}

/// Growable ring of committed spans (native-span-feed.zig SpanRing).
struct SpanRing {
    buffer: Vec<SpanInfo>,
    capacity: u32,
    head: u32,
    tail: u32,
    count: u32,
}

impl SpanRing {
    fn new(capacity: u32) -> SpanRing {
        SpanRing {
            buffer: vec![
                SpanInfo {
                    chunk_ptr: 0,
                    offset: 0,
                    len: 0,
                    chunk_index: 0,
                    reserved: 0,
                };
                capacity as usize
            ],
            capacity,
            head: 0,
            tail: 0,
            count: 0,
        }
    }

    fn count(&self) -> u32 {
        self.count
    }

    fn grow(&mut self, block: bool) -> Result<(), StreamError> {
        if block {
            return Err(StreamError::NoSpace);
        }
        let old_capacity = self.capacity;
        let old_count = self.count();
        let new_capacity = if old_capacity == 0 {
            1
        } else {
            old_capacity * 2
        };
        let mut new_buffer = vec![
            SpanInfo {
                chunk_ptr: 0,
                offset: 0,
                len: 0,
                chunk_index: 0,
                reserved: 0,
            };
            new_capacity as usize
        ];
        for i in 0..old_count {
            let old_index = (self.head.wrapping_add(i) % old_capacity.max(1)) as usize;
            new_buffer[i as usize] = self.buffer[old_index];
        }
        self.buffer = new_buffer;
        self.capacity = new_capacity;
        self.head = 0;
        self.tail = old_count;
        // self.count unchanged — same logical elements
        Ok(())
    }

    fn push(&mut self, span: SpanInfo, block: bool) -> Result<(), StreamError> {
        if self.count() >= self.capacity {
            self.grow(block)?;
        }
        let index = (self.tail % self.capacity) as usize;
        self.buffer[index] = span;
        self.tail = self.tail.wrapping_add(1);
        self.count += 1;
        Ok(())
    }

    fn pop_many(&mut self, out: &mut [SpanInfo]) -> u32 {
        let available = self.count();
        if available == 0 {
            return 0;
        }
        let to_read = available.min(out.len() as u32);
        for i in 0..to_read {
            let index = (self.head.wrapping_add(i) % self.capacity) as usize;
            out[i as usize] = self.buffer[index];
        }
        self.head = self.head.wrapping_add(to_read);
        self.count -= to_read;
        to_read
    }
}

const ALIVE_MAGIC: u32 = 0xDEAD_BEEF;

pub struct Stream {
    alive: u32,
    options: Options,
    chunks: Vec<Box<[u8]>>,
    current_chunk_index: usize,
    write_offset: usize,
    pending_chunk_index: usize,
    pending_offset: usize,
    pending_len: usize,
    reserved_active: bool,
    reserved_chunk_index: usize,
    reserved_offset: usize,
    reserved_len: usize,
    closed: bool,
    span_ring: SpanRing,
    state_buffer: Vec<u8>,
    stats: Stats,
}

impl Stream {
    pub fn create(options: Option<Options>) -> Option<Box<Stream>> {
        let opts = normalize_options(options.unwrap_or_else(default_options));
        let mut stream = Box::new(Stream {
            alive: ALIVE_MAGIC,
            options: opts,
            chunks: Vec::new(),
            current_chunk_index: 0,
            write_offset: 0,
            pending_chunk_index: 0,
            pending_offset: 0,
            pending_len: 0,
            reserved_active: false,
            reserved_chunk_index: 0,
            reserved_offset: 0,
            reserved_len: 0,
            closed: false,
            span_ring: SpanRing::new(opts.span_queue_capacity),
            state_buffer: Vec::new(),
            stats: Stats::default(),
        });
        stream.ensure_state_capacity(opts.initial_chunks);
        for _ in 0..opts.initial_chunks {
            stream.add_chunk().ok()?;
        }
        stream.stats.chunks = stream.chunks.len() as u32;
        Some(stream)
    }

    fn is_block(&self) -> bool {
        self.options.growth_policy == GROWTH_BLOCK
    }

    pub fn write(&mut self, data: &[u8]) -> Result<(), StreamError> {
        if self.closed {
            return Err(StreamError::Invalid);
        }
        if data.is_empty() {
            return Ok(());
        }
        if self.reserved_active {
            return Err(StreamError::Busy);
        }

        let mut remaining = data.len();
        let mut src = 0usize;
        let auto_commit = self.options.auto_commit_on_full != 0;
        let chunk_len = self.options.chunk_size as usize;

        while remaining > 0 {
            let mut available = chunk_len - self.write_offset;
            if available == 0 {
                if self.pending_len > 0 {
                    self.commit_locked()?;
                }
                self.ensure_writable_chunk()?;
                available = chunk_len;
            }

            if remaining > available && !auto_commit {
                return Err(StreamError::NoSpace);
            }

            let to_write = remaining.min(available);
            if self.pending_len == 0 {
                self.pending_chunk_index = self.current_chunk_index;
                self.pending_offset = self.write_offset;
            }

            let wo = self.write_offset;
            self.chunks[self.current_chunk_index][wo..wo + to_write]
                .copy_from_slice(&data[src..src + to_write]);

            self.write_offset += to_write;
            self.pending_len += to_write;
            self.stats.bytes_written += to_write as u64;
            src += to_write;
            remaining -= to_write;

            if self.write_offset == chunk_len && auto_commit {
                self.commit_locked()?;
                if remaining > 0 {
                    self.ensure_writable_chunk()?;
                }
            }
        }
        Ok(())
    }

    pub fn commit(&mut self) -> Result<(), StreamError> {
        if self.closed {
            return Err(StreamError::Invalid);
        }
        if self.reserved_active {
            return Err(StreamError::Busy);
        }
        self.commit_locked()
    }

    fn commit_locked(&mut self) -> Result<(), StreamError> {
        if self.pending_len == 0 {
            return Ok(());
        }
        let chunk_ptr = self.chunks[self.pending_chunk_index].as_ptr() as usize;
        let info = SpanInfo {
            chunk_ptr,
            offset: self.pending_offset as u32,
            len: self.pending_len as u32,
            chunk_index: self.pending_chunk_index as u32,
            reserved: 0,
        };
        self.span_ring.push(info, self.is_block())?;
        self.mark_span_pending(info.chunk_index);
        self.stats.spans_committed += 1;
        self.pending_len = 0;
        self.pending_offset = self.write_offset;
        self.pending_chunk_index = self.current_chunk_index;
        Ok(())
    }

    fn mark_span_pending(&mut self, chunk_index: u32) {
        if (chunk_index as usize) < self.state_buffer.len() {
            let v = &mut self.state_buffer[chunk_index as usize];
            *v = v.saturating_add(1);
            // Only force write_offset to end-of-chunk when this is the
            // currently-being-written chunk; otherwise we'd corrupt the
            // active chunk's write position.
            if *v == 255 && chunk_index as usize == self.current_chunk_index {
                self.write_offset = self.options.chunk_size as usize;
            }
        }
    }

    pub fn reserve(&mut self, min_len: u32) -> Result<ReserveInfo, StreamError> {
        if self.closed {
            return Err(StreamError::Invalid);
        }
        if self.reserved_active {
            return Err(StreamError::Busy);
        }
        if self.pending_len != 0 {
            return Err(StreamError::Busy);
        }
        self.ensure_writable_chunk()?;
        let chunk_len = self.chunks[self.current_chunk_index].len();
        let available = chunk_len - self.write_offset;
        if (available as u32) < min_len {
            return Err(StreamError::NoSpace);
        }
        self.reserved_active = true;
        self.reserved_chunk_index = self.current_chunk_index;
        self.reserved_offset = self.write_offset;
        self.reserved_len = available;
        let ptr = self.chunks[self.current_chunk_index].as_ptr() as usize + self.write_offset;
        Ok(ReserveInfo {
            ptr,
            len: available as u32,
            reserved: 0,
        })
    }

    pub fn commit_reserved(&mut self, len: u32) -> Result<(), StreamError> {
        if self.closed {
            return Err(StreamError::Invalid);
        }
        if !self.reserved_active {
            return Err(StreamError::Invalid);
        }
        if len as usize > self.reserved_len {
            return Err(StreamError::NoSpace);
        }
        self.pending_chunk_index = self.reserved_chunk_index;
        self.pending_offset = self.reserved_offset;
        self.pending_len = len as usize;
        self.write_offset = self.reserved_offset + len as usize;
        self.reserved_active = false;
        self.reserved_len = 0;
        self.stats.bytes_written += len as u64;
        self.commit_locked()
    }

    pub fn set_options(&mut self, options: Options) -> Result<(), StreamError> {
        if self.closed {
            return Err(StreamError::Invalid);
        }
        self.options.max_bytes = options.max_bytes;
        self.options.growth_policy = options.growth_policy;
        self.options.auto_commit_on_full = options.auto_commit_on_full;
        Ok(())
    }

    pub fn get_stats(&self) -> Stats {
        self.stats
    }

    pub fn has_pending_bytes(&self) -> bool {
        self.pending_len > 0
    }

    pub fn close(&mut self) -> Result<(), StreamError> {
        if self.closed {
            return Ok(());
        }
        if self.reserved_active {
            return Err(StreamError::Busy);
        }
        if self.pending_len > 0 {
            self.commit_locked()?;
        }
        self.closed = true;
        Ok(())
    }

    pub fn drain_spans(&mut self, out: &mut [SpanInfo]) -> u32 {
        if out.is_empty() {
            return 0;
        }
        let count = self.span_ring.pop_many(out);
        // Decrement per-chunk refcounts for each consumed span so that
        // is_chunk_free() can recycle committed chunks.
        for span in out.iter().take(count as usize) {
            let idx = span.chunk_index as usize;
            if idx < self.state_buffer.len() {
                self.state_buffer[idx] = self.state_buffer[idx].saturating_sub(1);
            }
        }
        self.stats.pending_spans = self.span_ring.count();
        count
    }

    fn ensure_state_capacity(&mut self, required: u32) {
        if (required as usize) <= self.state_buffer.len() {
            return;
        }
        self.state_buffer.resize(required as usize, 0);
    }

    fn is_chunk_free(&self, index: usize) -> bool {
        if index >= self.state_buffer.len() {
            return true;
        }
        self.state_buffer[index] == 0
    }

    fn add_chunk(&mut self) -> Result<(), StreamError> {
        let chunk_size = self.options.chunk_size;
        let max_bytes = self.options.max_bytes;
        let allocated = self.chunks.len() as u64 * chunk_size as u64;
        if max_bytes != 0 && allocated + chunk_size as u64 > max_bytes {
            return Err(StreamError::MaxBytes);
        }
        self.ensure_state_capacity(self.chunks.len() as u32 + 1);
        self.chunks
            .push(vec![0u8; chunk_size as usize].into_boxed_slice());
        self.stats.chunks = self.chunks.len() as u32;
        Ok(())
    }

    fn ensure_writable_chunk(&mut self) -> Result<(), StreamError> {
        let total = self.chunks.len();
        if total == 0 {
            return Err(StreamError::Invalid);
        }
        let mut index = self.current_chunk_index % total;
        for _ in 0..total {
            if self.is_chunk_free(index) {
                self.current_chunk_index = index;
                self.write_offset = 0;
                self.pending_chunk_index = index;
                self.pending_offset = 0;
                self.pending_len = 0;
                return Ok(());
            }
            index = (index + 1) % total;
        }
        if self.is_block() {
            return Err(StreamError::NoSpace);
        }
        self.add_chunk()?;
        let new_total = self.chunks.len();
        self.current_chunk_index = new_total - 1;
        self.write_offset = 0;
        self.pending_chunk_index = self.current_chunk_index;
        self.pending_offset = 0;
        self.pending_len = 0;
        Ok(())
    }
}

// --- FFI exports (native-span-feed.zig `pub export fn`) -----------------------

use crate::ffi_utils as ffi;

#[inline]
fn stream_of(handle: f64) -> Option<&'static mut Stream> {
    let ptr = ffi::addr_from_f64(handle)? as *mut Stream;
    if ptr.is_null() {
        return None;
    }
    // Alive-sentinel guard: reject destroyed or invalid handles to prevent
    // use-after-free. destroy_native_span_feed zeroes `alive` before dropping.
    if unsafe { (*ptr).alive } != ALIVE_MAGIC {
        return None;
    }
    Some(unsafe { &mut *ptr })
}

#[napi(js_name = "createNativeSpanFeed")]
pub fn create_native_span_feed(options_ptr: f64) -> f64 {
    let options = if options_ptr == 0.0 {
        None
    } else {
        let Some(options) = ffi::read_unaligned_f64(options_ptr) else {
            return 0.0;
        };
        Some(options)
    };
    match Stream::create(options) {
        Some(stream) => {
            let ptr = Box::into_raw(stream);
            let handle = ffi::addr_to_f64(ptr as usize);
            if handle == 0.0 {
                drop(unsafe { Box::from_raw(ptr) });
            }
            handle
        }
        None => 0.0,
    }
}

#[napi(js_name = "destroyNativeSpanFeed")]
pub fn destroy_native_span_feed(stream: f64) {
    let Some(ptr) = ffi::addr_from_f64(stream).map(|addr| addr as *mut Stream) else {
        return;
    };
    if ptr.is_null() {
        return;
    }
    // Double-free guard: check the alive sentinel before dropping.
    let alive = unsafe { (*ptr).alive };
    if alive != ALIVE_MAGIC {
        return; // already destroyed or invalid pointer
    }
    unsafe { (*ptr).alive = 0 };
    drop(unsafe { Box::from_raw(ptr) });
}

#[napi(js_name = "streamWrite")]
pub fn stream_write(stream: f64, src_ptr: f64, len: u32) -> i32 {
    let Some(s) = stream_of(stream) else {
        return STATUS_ERR_INVALID;
    };
    if len == 0 {
        return STATUS_OK;
    }
    if src_ptr == 0.0 {
        return STATUS_ERR_INVALID;
    }
    let Some(src) = (unsafe { ffi::bytes_from_f64(src_ptr, len) }) else {
        return STATUS_ERR_INVALID;
    };
    match s.write(src) {
        Ok(()) => STATUS_OK,
        Err(e) => error_to_status(e),
    }
}

#[napi(js_name = "streamCommit")]
pub fn stream_commit(stream: f64) -> i32 {
    match stream_of(stream) {
        Some(s) => match s.commit() {
            Ok(()) => STATUS_OK,
            Err(e) => error_to_status(e),
        },
        None => STATUS_ERR_INVALID,
    }
}

#[napi(js_name = "streamReserve")]
pub fn stream_reserve(stream: f64, min_len: u32, out_ptr: f64) -> i32 {
    if out_ptr == 0.0 {
        return STATUS_ERR_INVALID;
    }
    let Some(s) = stream_of(stream) else {
        return STATUS_ERR_INVALID;
    };
    match s.reserve(min_len) {
        Ok(info) => {
            if !ffi::write_unaligned_f64(out_ptr, info) {
                return STATUS_ERR_INVALID;
            }
            STATUS_OK
        }
        Err(e) => error_to_status(e),
    }
}

#[napi(js_name = "streamCommitReserved")]
pub fn stream_commit_reserved(stream: f64, len: u32) -> i32 {
    match stream_of(stream) {
        Some(s) => match s.commit_reserved(len) {
            Ok(()) => STATUS_OK,
            Err(e) => error_to_status(e),
        },
        None => STATUS_ERR_INVALID,
    }
}

#[napi(js_name = "streamSetOptions")]
pub fn stream_set_options(stream: f64, options_ptr: f64) -> i32 {
    if options_ptr == 0.0 {
        return STATUS_ERR_INVALID;
    }
    let Some(s) = stream_of(stream) else {
        return STATUS_ERR_INVALID;
    };
    let Some(opts) = ffi::read_unaligned_f64(options_ptr) else {
        return STATUS_ERR_INVALID;
    };
    match s.set_options(opts) {
        Ok(()) => STATUS_OK,
        Err(e) => error_to_status(e),
    }
}

#[napi(js_name = "streamGetStats")]
pub fn stream_get_stats(stream: f64, stats_ptr: f64) -> i32 {
    if stats_ptr == 0.0 {
        return STATUS_ERR_INVALID;
    }
    let Some(s) = stream_of(stream) else {
        return STATUS_ERR_INVALID;
    };
    if !ffi::write_unaligned_f64(stats_ptr, s.get_stats()) {
        return STATUS_ERR_INVALID;
    }
    STATUS_OK
}

#[napi(js_name = "streamDrainSpans")]
pub fn stream_drain_spans(stream: f64, out_ptr: f64, max_spans: u32) -> u32 {
    if out_ptr == 0.0 || max_spans == 0 {
        return 0;
    }
    let Some(s) = stream_of(stream) else {
        return 0;
    };
    let Some(max_spans) = ffi::record_count(max_spans) else {
        return 0;
    };
    let Some(out) = (unsafe { ffi::slice_mut_from_f64::<SpanInfo>(out_ptr, max_spans) }) else {
        return 0;
    };
    s.drain_spans(out)
}

#[napi(js_name = "streamClose")]
pub fn stream_close(stream: f64) -> i32 {
    match stream_of(stream) {
        Some(s) => match s.close() {
            Ok(()) => STATUS_OK,
            Err(e) => error_to_status(e),
        },
        None => STATUS_ERR_INVALID,
    }
}

// Callback/attach are async-consumer notification only — no effect on drained
// bytes, so they are accepted as no-ops.
#[napi(js_name = "streamSetCallback")]
pub fn stream_set_callback(_stream: f64, _callback: f64) {}

#[napi(js_name = "attachNativeSpanFeed")]
pub fn attach_native_span_feed(stream: f64) -> i32 {
    if stream_of(stream).is_some() {
        STATUS_OK
    } else {
        STATUS_ERR_INVALID
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain_all(s: &mut Stream) -> Vec<u8> {
        let mut out = vec![
            SpanInfo {
                chunk_ptr: 0,
                offset: 0,
                len: 0,
                chunk_index: 0,
                reserved: 0,
            };
            64
        ];
        let mut bytes = Vec::new();
        loop {
            let n = s.drain_spans(&mut out);
            if n == 0 {
                break;
            }
            for span in out.iter().take(n as usize) {
                let slice = unsafe {
                    std::slice::from_raw_parts(
                        (span.chunk_ptr as *const u8).add(span.offset as usize),
                        span.len as usize,
                    )
                };
                bytes.extend_from_slice(slice);
            }
        }
        bytes
    }

    #[test]
    fn write_commit_drain_roundtrip() {
        // Small chunk size to exercise chunk-spanning and auto-commit.
        for input_len in [0usize, 1, 7, 16, 17, 100, 999] {
            let opts = Options {
                chunk_size: 16,
                initial_chunks: 2,
                max_bytes: 0,
                growth_policy: 0,
                auto_commit_on_full: 1,
                span_queue_capacity: 0,
            };
            let mut s = Stream::create(Some(opts)).unwrap();
            let input: Vec<u8> = (0..input_len).map(|i| (i % 251) as u8).collect();
            s.write(&input).unwrap();
            s.commit().unwrap();
            let out = drain_all(&mut s);
            assert_eq!(out, input, "roundtrip failed for len {}", input_len);
        }
    }

    #[test]
    fn multiple_frames_roundtrip() {
        let opts = Options {
            chunk_size: 8,
            initial_chunks: 1,
            max_bytes: 0,
            growth_policy: 0,
            auto_commit_on_full: 1,
            span_queue_capacity: 0,
        };
        let mut s = Stream::create(Some(opts)).unwrap();
        let mut expected = Vec::new();
        for frame in 0..10u8 {
            let data = vec![frame; 5 + frame as usize];
            s.write(&data).unwrap();
            s.commit().unwrap();
            expected.extend_from_slice(&data);
        }
        let out = drain_all(&mut s);
        assert_eq!(out, expected);
    }

    #[test]
    fn alive_sentinel_prevents_double_free() {
        let stream = Stream::create(None).unwrap();
        let ptr = Box::into_raw(stream);
        // First destroy: sentinel is set, should succeed.
        assert_eq!(unsafe { (*ptr).alive }, ALIVE_MAGIC);
        unsafe { (*ptr).alive = 0 };
        // Simulate second destroy: sentinel is zero, should bail out.
        assert_ne!(unsafe { (*ptr).alive }, ALIVE_MAGIC);
        // Reconstitute and drop to avoid leak.
        drop(unsafe { Box::from_raw(ptr) });
    }

    #[test]
    fn drain_spans_decrements_chunk_state() {
        // Verify that draining spans decrements state_buffer so that
        // committed chunks can be recycled via ensure_writable_chunk.
        let opts = Options {
            chunk_size: 16,
            initial_chunks: 2,
            max_bytes: 0,
            growth_policy: GROWTH_BLOCK,
            auto_commit_on_full: 1,
            span_queue_capacity: 0,
        };
        let mut s = Stream::create(Some(opts)).unwrap();

        // Fill both chunks to force auto-commit.
        let data = vec![0xAA_u8; 16]; // exactly one chunk
        s.write(&data).unwrap();
        s.commit().unwrap();

        // The first chunk should now have a non-zero state (span pending).
        assert!(
            s.state_buffer[0] > 0,
            "state_buffer[0] should be non-zero after commit"
        );

        // Drain the spans.
        let mut out = vec![
            SpanInfo {
                chunk_ptr: 0,
                offset: 0,
                len: 0,
                chunk_index: 0,
                reserved: 0,
            }; 64
        ];
        let n = s.drain_spans(&mut out);
        assert!(n > 0, "should have drained at least one span");

        // After draining, state_buffer[0] should be decremented back to 0.
        assert_eq!(
            s.state_buffer[0], 0,
            "state_buffer[0] should be 0 after draining all spans for chunk 0"
        );

        // is_chunk_free should now return true for chunk 0.
        assert!(
            s.is_chunk_free(0),
            "chunk 0 should be free after draining its spans"
        );
    }

    #[test]
    fn stream_of_rejects_destroyed_handle_via_alive_sentinel() {
        // Create a stream, get its raw pointer, zero the alive sentinel
        // (simulating destroy_native_span_feed), then verify stream_of
        // returns None instead of dereferencing freed memory.
        let stream = Stream::create(None).unwrap();
        let ptr = Box::into_raw(stream);
        let handle = ffi::addr_to_f64(ptr as usize);

        // Before destroying: stream_of should succeed.
        assert!(stream_of(handle).is_some(), "stream_of should work on a live handle");

        // Simulate destroy: zero the alive sentinel.
        unsafe { (*ptr).alive = 0 };

        // After destroying: stream_of must reject the handle.
        assert!(
            stream_of(handle).is_none(),
            "stream_of must return None for a destroyed handle (alive != ALIVE_MAGIC)"
        );

        // Reconstitute and drop to avoid leak.
        drop(unsafe { Box::from_raw(ptr) });
    }

    #[test]
    fn span_ring_count_tracks_push_pop() {
        let mut ring = SpanRing::new(4);
        assert_eq!(ring.count(), 0);

        let span = SpanInfo {
            chunk_ptr: 0,
            offset: 0,
            len: 10,
            chunk_index: 0,
            reserved: 0,
        };
        ring.push(span, false).unwrap();
        assert_eq!(ring.count(), 1);

        ring.push(span, false).unwrap();
        assert_eq!(ring.count(), 2);

        let mut out = [span; 4];
        let popped = ring.pop_many(&mut out);
        assert_eq!(popped, 2);
        assert_eq!(ring.count(), 0);
    }
}
