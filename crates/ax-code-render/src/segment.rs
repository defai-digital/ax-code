//! ADR-046 Slice C2 — text segments, ported from the Zig reference
//! (`text-buffer-segment.zig`, opentui v0.4.1).
//!
//! A `Segment` is either a text chunk (a byte range into a MemRegistry
//! buffer with a display width and lazily cached grapheme/wrap info) or a
//! marker (`Brk` = newline, `LineStart`). Segments live in the generic rope
//! (Slice C1); metrics aggregate width/bytes/line counts and the rope weight
//! is `total_width + newline_count` — breaks occupy one weight unit so
//! weight-space addresses columns across lines.

use crate::mem_registry::MemRegistry;
use crate::rope::RopeItem;
use crate::unicode::{GraphemeInfo, WidthMethod, WrapBreak, find_grapheme_info, find_wrap_breaks};
use std::cell::RefCell;
use std::rc::Rc;

pub const FLAG_ASCII_ONLY: u8 = 0b0000_0001;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WrapMode {
    None,
    Char,
    Word,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Highlight {
    pub col_start: u32,
    pub col_end: u32,
    pub style_id: u32,
    pub priority: u8,
    pub hl_ref: u16,
    pub internal: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StyleSpan {
    pub col: u32,
    pub style_id: u32,
    pub next_col: u32,
}

#[derive(Debug)]
pub struct TextChunk {
    pub mem_id: u8,
    pub byte_start: u32,
    pub byte_end: u32,
    pub width: u16,
    pub flags: u8,
    graphemes: RefCell<Option<Rc<Vec<GraphemeInfo>>>>,
    wrap_offsets: RefCell<Option<Rc<Vec<WrapBreak>>>>,
}

impl Clone for TextChunk {
    fn clone(&self) -> TextChunk {
        TextChunk {
            mem_id: self.mem_id,
            byte_start: self.byte_start,
            byte_end: self.byte_end,
            width: self.width,
            flags: self.flags,
            // Caches are shared: cloned chunks reference the same computed data.
            graphemes: RefCell::new(self.graphemes.borrow().clone()),
            wrap_offsets: RefCell::new(self.wrap_offsets.borrow().clone()),
        }
    }
}

impl TextChunk {
    pub fn new(mem_id: u8, byte_start: u32, byte_end: u32, width: u16, flags: u8) -> TextChunk {
        TextChunk {
            mem_id,
            byte_start,
            byte_end,
            width,
            flags,
            graphemes: RefCell::new(None),
            wrap_offsets: RefCell::new(None),
        }
    }

    pub fn empty() -> TextChunk {
        TextChunk::new(0, 0, 0, 0, 0)
    }

    pub fn is_ascii_only(&self) -> bool {
        (self.flags & FLAG_ASCII_ONLY) != 0
    }

    pub fn is_empty(&self) -> bool {
        self.width == 0
    }

    pub fn byte_len(&self) -> u32 {
        self.byte_end - self.byte_start
    }

    pub fn bytes<'a>(&self, registry: &'a MemRegistry) -> &'a [u8] {
        match registry.get(self.mem_id) {
            Some(buf) => &buf[self.byte_start as usize..self.byte_end as usize],
            None => &[],
        }
    }

    /// Lazily computed grapheme info (empty for printable-ASCII chunks).
    pub fn graphemes(
        &self,
        registry: &MemRegistry,
        tab_width: u8,
        method: WidthMethod,
    ) -> Rc<Vec<GraphemeInfo>> {
        if let Some(cached) = self.graphemes.borrow().as_ref() {
            return cached.clone();
        }
        let computed = if self.is_ascii_only() {
            Rc::new(Vec::new())
        } else {
            let bytes = self.bytes(registry);
            let text = std::str::from_utf8(bytes).unwrap_or("");
            Rc::new(find_grapheme_info(text, method, tab_width))
        };
        *self.graphemes.borrow_mut() = Some(computed.clone());
        computed
    }

    /// Lazily computed newline positions within the chunk.
    pub fn wrap_offsets(&self, registry: &MemRegistry) -> Rc<Vec<WrapBreak>> {
        if let Some(cached) = self.wrap_offsets.borrow().as_ref() {
            return cached.clone();
        }
        let bytes = self.bytes(registry);
        let computed = Rc::new(find_wrap_breaks(bytes));
        *self.wrap_offsets.borrow_mut() = Some(computed.clone());
        computed
    }
}

#[derive(Clone, Debug)]
pub enum Segment {
    Text(TextChunk),
    Brk,
    LineStart,
}

#[derive(Clone, Copy, Debug)]
pub struct SegMetrics {
    pub total_width: u32,
    pub total_bytes: u32,
    pub linestart_count: u32,
    pub newline_count: u32,
    pub max_line_width: u32,
    pub ascii_only: bool,
}

impl Default for SegMetrics {
    fn default() -> SegMetrics {
        SegMetrics {
            total_width: 0,
            total_bytes: 0,
            linestart_count: 0,
            newline_count: 0,
            max_line_width: 0,
            ascii_only: true,
        }
    }
}

impl Segment {
    pub fn is_break(&self) -> bool {
        matches!(self, Segment::Brk)
    }
    pub fn is_line_start(&self) -> bool {
        matches!(self, Segment::LineStart)
    }
    pub fn is_text(&self) -> bool {
        matches!(self, Segment::Text(_))
    }
    pub fn as_text(&self) -> Option<&TextChunk> {
        match self {
            Segment::Text(chunk) => Some(chunk),
            _ => None,
        }
    }

    pub fn bytes<'a>(&self, registry: &'a MemRegistry) -> &'a [u8] {
        match self {
            Segment::Text(chunk) => chunk.bytes(registry),
            _ => &[],
        }
    }

    /// Adjacent text chunks over the same memory can merge (used to keep the
    /// rope compact after edits).
    pub fn can_merge(left: &Segment, right: &Segment) -> bool {
        let (Some(l), Some(r)) = (left.as_text(), right.as_text()) else {
            return false;
        };
        l.mem_id == r.mem_id && l.byte_end == r.byte_start
    }
}

impl RopeItem for Segment {
    type Metrics = SegMetrics;
    const MARKER_COUNT: usize = 2; // 0 = brk, 1 = linestart

    fn measure(&self) -> SegMetrics {
        match self {
            Segment::Text(chunk) => SegMetrics {
                total_width: chunk.width as u32,
                total_bytes: chunk.byte_len(),
                linestart_count: 0,
                newline_count: 0,
                max_line_width: chunk.width as u32,
                ascii_only: chunk.is_ascii_only(),
            },
            Segment::Brk => SegMetrics {
                newline_count: 1,
                ..SegMetrics::default()
            },
            Segment::LineStart => SegMetrics {
                linestart_count: 1,
                ..SegMetrics::default()
            },
        }
    }

    fn metrics_add(dst: &mut SegMetrics, src: &SegMetrics) {
        dst.total_width += src.total_width;
        dst.total_bytes += src.total_bytes;
        dst.linestart_count += src.linestart_count;
        dst.newline_count += src.newline_count;
        dst.max_line_width = dst.max_line_width.max(src.max_line_width);
        dst.ascii_only = dst.ascii_only && src.ascii_only;
    }

    fn metrics_weight(m: &SegMetrics) -> Option<u32> {
        Some(m.total_width + m.newline_count)
    }

    fn marker_slot(&self) -> Option<usize> {
        match self {
            Segment::Brk => Some(0),
            Segment::LineStart => Some(1),
            Segment::Text(_) => None,
        }
    }
}

pub const MARKER_BRK: usize = 0;
pub const MARKER_LINESTART: usize = 1;

/// Result of a boundary rewrite after an edit (Zig `BoundaryAction`).
#[derive(Default)]
pub struct BoundaryAction {
    pub delete_left: bool,
    pub delete_right: bool,
    pub insert_between: Vec<Segment>,
}

/// Zig `rewriteBoundary`: normalize the seam between two segments after an
/// edit — collapse duplicate linestarts, materialize the linestart that
/// follows every break.
pub fn rewrite_boundary(left: Option<&Segment>, right: Option<&Segment>) -> BoundaryAction {
    let (Some(l), Some(r)) = (left, right) else {
        return BoundaryAction::default();
    };
    if l.is_line_start() && r.is_line_start() {
        return BoundaryAction {
            delete_right: true,
            ..Default::default()
        };
    }
    if l.is_break() && r.is_break() {
        return BoundaryAction {
            insert_between: vec![Segment::LineStart],
            ..Default::default()
        };
    }
    if l.is_break() && r.is_text() {
        return BoundaryAction {
            insert_between: vec![Segment::LineStart],
            ..Default::default()
        };
    }
    if l.is_text() && r.is_line_start() {
        return BoundaryAction {
            delete_right: true,
            ..Default::default()
        };
    }
    BoundaryAction::default()
}

/// Zig `rewriteEnds`: the rope must always start with a linestart marker.
pub fn rewrite_ends(first: Option<&Segment>, _last: Option<&Segment>) -> BoundaryAction {
    match first {
        Some(seg) if seg.is_line_start() => BoundaryAction::default(),
        _ => BoundaryAction {
            insert_between: vec![Segment::LineStart],
            ..Default::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mem_registry::MemBuffer;
    use crate::rope::Rope;

    fn registry_with(text: &str) -> (MemRegistry, u8) {
        let mut reg = MemRegistry::new();
        let id = reg
            .register(MemBuffer::Owned(text.as_bytes().to_vec()))
            .unwrap();
        (reg, id)
    }

    fn chunk(mem_id: u8, start: u32, end: u32, width: u16, ascii: bool) -> Segment {
        Segment::Text(TextChunk::new(
            mem_id,
            start,
            end,
            width,
            if ascii { FLAG_ASCII_ONLY } else { 0 },
        ))
    }

    #[test]
    fn metrics_and_weight() {
        let rope = Rope::from_slice(&[
            Segment::LineStart,
            chunk(0, 0, 5, 5, true),
            Segment::Brk,
            Segment::LineStart,
            chunk(0, 5, 8, 3, true),
        ]);
        let m = rope.metrics();
        assert_eq!(m.custom.total_width, 8);
        assert_eq!(m.custom.total_bytes, 8);
        assert_eq!(m.custom.newline_count, 1);
        assert_eq!(m.custom.linestart_count, 2);
        assert_eq!(m.custom.max_line_width, 5);
        assert!(m.custom.ascii_only);
        // weight = width + newlines
        assert_eq!(rope.total_weight(), 9);
    }

    #[test]
    fn chunk_bytes_and_caches() {
        let (reg, id) = registry_with("hello 世界");
        let c = TextChunk::new(id, 0, 12, 10, 0);
        assert_eq!(c.bytes(&reg), "hello 世界".as_bytes());
        let g1 = c.graphemes(&reg, 2, WidthMethod::Unicode);
        let g2 = c.graphemes(&reg, 2, WidthMethod::Unicode);
        assert!(Rc::ptr_eq(&g1, &g2)); // cached
        assert!(!g1.is_empty()); // CJK clusters recorded as specials

        let cloned = c.clone();
        let g3 = cloned.graphemes(&reg, 2, WidthMethod::Unicode);
        assert!(Rc::ptr_eq(&g1, &g3)); // clone shares the cache
    }

    #[test]
    fn ascii_chunk_has_no_specials() {
        let (reg, id) = registry_with("plain text");
        let c = TextChunk::new(id, 0, 10, 10, FLAG_ASCII_ONLY);
        assert!(c.graphemes(&reg, 2, WidthMethod::Unicode).is_empty());
    }

    #[test]
    fn wrap_offsets_cache() {
        let (reg, id) = registry_with("a\nb\r\nc\rd");
        let c = TextChunk::new(id, 0, 8, 4, 0);
        let breaks = c.wrap_offsets(&reg);
        let kinds: Vec<_> = breaks.iter().map(|b| (b.pos, b.kind)).collect();
        use crate::unicode::LineBreakKind::*;
        assert_eq!(kinds, vec![(1, Lf), (4, Crlf), (6, Cr)]);
    }

    #[test]
    fn merge_and_boundaries() {
        let a = chunk(0, 0, 5, 5, true);
        let b = chunk(0, 5, 9, 4, true);
        let c = chunk(1, 9, 12, 3, true);
        assert!(Segment::can_merge(&a, &b));
        assert!(!Segment::can_merge(&b, &a));
        assert!(!Segment::can_merge(&b, &c)); // different mem_id
        assert!(!Segment::can_merge(&a, &Segment::Brk));

        let act = rewrite_boundary(Some(&Segment::Brk), Some(&b));
        assert_eq!(act.insert_between.len(), 1);
        assert!(act.insert_between[0].is_line_start());

        let act = rewrite_boundary(Some(&a), Some(&Segment::LineStart));
        assert!(act.delete_right);

        let act = rewrite_boundary(Some(&Segment::LineStart), Some(&Segment::LineStart));
        assert!(act.delete_right);

        let act = rewrite_boundary(Some(&Segment::Brk), Some(&Segment::Brk));
        assert_eq!(act.insert_between.len(), 1);

        let act = rewrite_boundary(Some(&a), Some(&b));
        assert!(!act.delete_left && !act.delete_right && act.insert_between.is_empty());

        let act = rewrite_ends(Some(&a), None);
        assert_eq!(act.insert_between.len(), 1);
        let act = rewrite_ends(Some(&Segment::LineStart), None);
        assert!(act.insert_between.is_empty());
        let act = rewrite_ends(None, None);
        assert_eq!(act.insert_between.len(), 1);
    }

    #[test]
    fn registry_slots() {
        let mut reg = MemRegistry::new();
        let a = reg.register(MemBuffer::Owned(b"aaa".to_vec())).unwrap();
        let b = reg.register(MemBuffer::Owned(b"bbb".to_vec())).unwrap();
        assert_eq!(reg.get(a), Some(&b"aaa"[..]));
        assert_eq!(reg.get(b), Some(&b"bbb"[..]));
        assert_eq!(reg.used_slots(), 2);

        assert!(reg.unregister(a));
        assert_eq!(reg.get(a), None);
        assert!(!reg.unregister(a)); // double unregister fails

        // freed slot is reused LIFO
        let c = reg.register(MemBuffer::Owned(b"ccc".to_vec())).unwrap();
        assert_eq!(c, a);
        assert_eq!(reg.get(c), Some(&b"ccc"[..]));

        assert!(reg.replace(c, MemBuffer::Owned(b"c2".to_vec())));
        assert_eq!(reg.get(c), Some(&b"c2"[..]));
        assert!(!reg.replace(99, MemBuffer::Owned(Vec::new())));

        reg.clear();
        assert_eq!(reg.used_slots(), 0);
        assert_eq!(reg.get(b), None);
    }

    #[test]
    fn markers_in_rope() {
        let mut rope = Rope::from_slice(&[
            Segment::LineStart,
            chunk(0, 0, 3, 3, true),
            Segment::Brk,
            Segment::LineStart,
            chunk(0, 3, 6, 3, true),
        ]);
        assert_eq!(rope.marker_count(MARKER_BRK), 1);
        assert_eq!(rope.marker_count(MARKER_LINESTART), 2);
        // second linestart sits after "abc" (width 3) + brk (weight 1) = 4
        let m = rope.get_marker(MARKER_LINESTART, 1).unwrap();
        assert_eq!(m.global_weight, 4);
    }
}
