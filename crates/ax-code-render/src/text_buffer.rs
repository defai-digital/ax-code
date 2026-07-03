//! ADR-046 Slice C3a — TextBuffer core, ported from the Zig reference
//! (`text-buffer.zig` UnifiedTextBuffer, opentui v0.4.1).
//!
//! Text lives in MemRegistry buffers; the rope holds [LineStart, chunks...,
//! Brk, LineStart, ...] segments produced by splitting input at newlines
//! (CRLF folds to one break). Observable surface this tranche: plain text,
//! length (total width), byte size (bytes + newline count), line count
//! (linestart markers), tab width, defaults, and the mem-buffer symbols.
//! Highlights/syntax (C4), views + text ranges via weight-space iterators
//! (C3b/C5) come next.

use crate::buffer::Rgba;
use crate::mem_registry::{MemBuffer, MemRegistry};
use crate::rope::Rope;
use crate::segment::{FLAG_ASCII_ONLY, MARKER_LINESTART, Segment, TextChunk};
use crate::unicode::{
    LineBreakKind, WidthMethod, calculate_text_width, find_line_breaks, is_ascii_only,
};

pub struct StyledChunkIn<'a> {
    pub text: &'a [u8],
    pub fg: Option<Rgba>,
    pub bg: Option<Rgba>,
    pub attributes: u32,
    pub link: Option<&'a [u8]>,
}

pub struct TextBuffer {
    pub registry: MemRegistry,
    pub rope: Rope<Segment>,
    pub width_method: WidthMethod,
    pub tab_width: u8,
    pub default_fg: Option<Rgba>,
    pub default_bg: Option<Rgba>,
    pub default_attributes: Option<u32>,
    styled_text_mem_id: Option<u8>,
}

impl TextBuffer {
    pub fn new(width_method: WidthMethod) -> TextBuffer {
        TextBuffer {
            registry: MemRegistry::new(),
            rope: Rope::new(),
            width_method,
            tab_width: 2,
            default_fg: None,
            default_bg: None,
            default_attributes: None,
            styled_text_mem_id: None,
        }
    }

    pub fn get_length(&self) -> u32 {
        self.rope.metrics().custom.total_width
    }

    pub fn get_line_count(&self) -> u32 {
        self.rope.metrics().custom.linestart_count
    }

    pub fn get_byte_size(&self) -> u32 {
        let total_bytes = self.rope.metrics().custom.total_bytes;
        let line_count = self.get_line_count();
        if line_count > 0 {
            total_bytes + (line_count - 1)
        } else {
            total_bytes
        }
    }

    pub fn measure_text(&self, text: &str) -> u32 {
        calculate_text_width(text, self.tab_width, self.width_method)
    }

    /// Zig clamps to >= 2 and rounds odd widths UP to the next even value.
    pub fn set_tab_width(&mut self, width: u8) {
        let clamped = width.max(2);
        self.tab_width = if clamped % 2 == 0 {
            clamped
        } else {
            clamped + 1
        };
    }

    pub fn clear(&mut self) {
        self.rope.clear();
    }

    /// Zig `reset`: drop highlights/styled buffer, clear the registry AND the rope.
    pub fn reset(&mut self) {
        self.styled_text_mem_id = None;
        self.registry.clear();
        self.rope = Rope::new();
    }

    pub fn create_chunk(&self, mem_id: u8, byte_start: u32, byte_end: u32) -> TextChunk {
        let buf = self.registry.get(mem_id).unwrap_or(&[]);
        let bytes = &buf[byte_start as usize..byte_end as usize];
        let text = std::str::from_utf8(bytes).unwrap_or("");
        let ascii = is_ascii_only(text);
        let flags = if !bytes.is_empty() && ascii {
            FLAG_ASCII_ONLY
        } else {
            0
        };
        let width = calculate_text_width(text, self.tab_width, self.width_method).min(65535) as u16;
        TextChunk::new(mem_id, byte_start, byte_end, width, flags)
    }

    /// Zig `textToSegments`: split at newlines into [chunk?, Brk, LineStart]
    /// runs; CRLF collapses to a single break (the \r is excluded from the
    /// chunk and the next chunk starts after the \n).
    pub fn text_to_segments(
        &self,
        text: &[u8],
        mem_id: u8,
        byte_offset: u32,
        prepend_linestart: bool,
    ) -> Vec<Segment> {
        let breaks = find_line_breaks(text);
        let mut segments = Vec::new();
        if prepend_linestart {
            segments.push(Segment::LineStart);
        }
        let mut local_start: u32 = 0;
        for lb in &breaks {
            let break_pos = lb.pos;
            let local_end = match lb.kind {
                LineBreakKind::Crlf => break_pos - 1,
                LineBreakKind::Cr | LineBreakKind::Lf => break_pos,
            };
            if local_end > local_start {
                segments.push(Segment::Text(self.create_chunk(
                    mem_id,
                    byte_offset + local_start,
                    byte_offset + local_end,
                )));
            }
            segments.push(Segment::Brk);
            segments.push(Segment::LineStart);
            local_start = break_pos + 1;
        }
        if (local_start as usize) < text.len() {
            segments.push(Segment::Text(self.create_chunk(
                mem_id,
                byte_offset + local_start,
                byte_offset + text.len() as u32,
            )));
        }
        segments
    }

    fn set_text_internal(&mut self, mem_id: u8, len: usize) {
        if len == 0 {
            return;
        }
        let text = self.registry.get(mem_id).unwrap_or(&[]).to_vec();
        let segments = self.text_to_segments(&text, mem_id, 0, true);
        self.rope.set_items(&segments);
    }

    fn append_internal(&mut self, mem_id: u8, len: usize) {
        if len == 0 {
            return;
        }
        let text = self.registry.get(mem_id).unwrap_or(&[]).to_vec();
        let segments = self.text_to_segments(&text, mem_id, 0, false);
        let pos = self.rope.count();
        self.rope.insert_slice(pos, &segments);
    }

    pub fn set_text(&mut self, buffer: MemBuffer, len: usize) -> Option<u8> {
        self.clear();
        let mem_id = self.registry.register(buffer)?;
        self.set_text_internal(mem_id, len);
        Some(mem_id)
    }

    pub fn set_text_from_mem(&mut self, mem_id: u8) -> bool {
        let Some(text) = self.registry.get(mem_id) else {
            return false;
        };
        let len = text.len();
        self.clear();
        self.set_text_internal(mem_id, len);
        true
    }

    pub fn append(&mut self, buffer: MemBuffer, len: usize) -> Option<u8> {
        if len == 0 {
            return None;
        }
        let mem_id = self.registry.register(buffer)?;
        self.append_internal(mem_id, len);
        Some(mem_id)
    }

    pub fn append_from_mem(&mut self, mem_id: u8) -> bool {
        let Some(text) = self.registry.get(mem_id) else {
            return false;
        };
        let len = text.len();
        self.append_internal(mem_id, len);
        true
    }

    /// Zig `setStyledText` text path (highlight/link styling lands in C4):
    /// concatenate all chunk text into one owned buffer, register or replace
    /// the dedicated styled-text mem slot, and rebuild the rope from it.
    pub fn set_styled_text(&mut self, chunks: &[StyledChunkIn]) {
        let total_len: usize = chunks.iter().map(|c| c.text.len()).sum();
        if chunks.is_empty() || total_len == 0 {
            self.clear();
            return;
        }
        self.clear();
        let mut full_text = Vec::with_capacity(total_len);
        for chunk in chunks {
            full_text.extend_from_slice(chunk.text);
        }
        let mem_id = match self.styled_text_mem_id {
            Some(id) => {
                self.registry.replace(id, MemBuffer::Owned(full_text));
                id
            }
            None => {
                let id = self
                    .registry
                    .register(MemBuffer::Owned(full_text))
                    .unwrap_or(0);
                self.styled_text_mem_id = Some(id);
                id
            }
        };
        self.set_text_internal(mem_id, total_len);
    }

    /// Zig `getPlainTextIntoBuffer` semantics: chunk bytes joined with a
    /// newline per break (equivalently: '\n' between lines, none trailing).
    pub fn plain_text(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.rope.walk(&mut |segment, _| {
            match segment {
                Segment::Text(chunk) => out.extend_from_slice(chunk.bytes(&self.registry)),
                Segment::Brk => out.push(b'\n'),
                Segment::LineStart => {}
            }
            true
        });
        out
    }

    pub fn line_count_markers(&mut self) -> u32 {
        self.rope.marker_count(MARKER_LINESTART)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tb_with(text: &str) -> TextBuffer {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        tb.set_text(MemBuffer::Owned(text.as_bytes().to_vec()), text.len());
        tb
    }

    #[test]
    fn single_line() {
        let tb = tb_with("hello");
        assert_eq!(tb.get_length(), 5);
        assert_eq!(tb.get_line_count(), 1);
        assert_eq!(tb.get_byte_size(), 5);
        assert_eq!(tb.plain_text(), b"hello");
    }

    #[test]
    fn multi_line_and_crlf() {
        let tb = tb_with("ab\ncd\r\nef");
        assert_eq!(tb.get_line_count(), 3);
        assert_eq!(tb.plain_text(), b"ab\ncd\nef");
        // bytes: ab(2) + cd(2) + ef(2) = 6 chunk bytes + 2 newlines
        assert_eq!(tb.get_byte_size(), 8);
        assert_eq!(tb.get_length(), 6);
    }

    #[test]
    fn empty_lines() {
        let tb = tb_with("a\n\nb");
        assert_eq!(tb.get_line_count(), 3);
        assert_eq!(tb.plain_text(), b"a\n\nb");
        let tb = tb_with("x\n");
        assert_eq!(tb.get_line_count(), 2);
        assert_eq!(tb.plain_text(), b"x\n");
    }

    #[test]
    fn cjk_width() {
        let tb = tb_with("a世界b");
        assert_eq!(tb.get_length(), 6); // 1 + 2 + 2 + 1
        assert_eq!(tb.get_byte_size(), 8);
    }

    #[test]
    fn append_and_reset() {
        let mut tb = tb_with("one");
        tb.append(MemBuffer::Owned(b"\ntwo".to_vec()), 4);
        assert_eq!(tb.plain_text(), b"one\ntwo");
        assert_eq!(tb.get_line_count(), 2);

        tb.reset();
        assert_eq!(tb.get_length(), 0);
        // The rope's ends invariant keeps a leading LineStart: empty = 1 line.
        assert_eq!(tb.get_line_count(), 1);
        assert_eq!(tb.plain_text(), b"");
    }

    #[test]
    fn styled_text_concat() {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        tb.set_styled_text(&[
            StyledChunkIn {
                text: b"red ",
                fg: None,
                bg: None,
                attributes: 0,
                link: None,
            },
            StyledChunkIn {
                text: b"blue\nline2",
                fg: None,
                bg: None,
                attributes: 0,
                link: None,
            },
        ]);
        assert_eq!(tb.plain_text(), b"red blue\nline2");
        assert_eq!(tb.get_line_count(), 2);

        // replaces the styled slot on re-set
        tb.set_styled_text(&[StyledChunkIn {
            text: b"v2",
            fg: None,
            bg: None,
            attributes: 0,
            link: None,
        }]);
        assert_eq!(tb.plain_text(), b"v2");
    }

    #[test]
    fn tab_width_affects_measure() {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        // tab in non-printable-ASCII text goes through cluster measurement
        assert_eq!(tb.measure_text("\t世"), 4); // 2 (tab) + 2
        tb.set_tab_width(4);
        assert_eq!(tb.measure_text("\t世"), 6);
    }
}
