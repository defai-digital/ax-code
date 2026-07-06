//! Grapheme cluster segmentation matching uucode (the unicode library inside
//! the shipped Zig binary) — a 1:1 transliteration of its
//! `computeGraphemeBreak` state machine over the generated Unicode 16.0.0
//! property table. Deliberate deviations from stock UAX #29 that uucode makes
//! (and we must match): `emoji_modifier` is split out of Extend and follows
//! UTS #51 emoji-modifier-sequence rules; `isExtendedPictographic` covers
//! `extended_pictographic` and `emoji_modifier_base` only.

use crate::gcb_table::GCB_RANGES;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Gcb {
    Other = 0,
    Control = 1,
    Prepend = 2,
    Cr = 3,
    Lf = 4,
    RegionalIndicator = 5,
    SpacingMark = 6,
    L = 7,
    V = 8,
    T = 9,
    Lv = 10,
    Lvt = 11,
    Zwj = 12,
    Zwnj = 13,
    ExtendedPictographic = 14,
    EmojiModifierBase = 15,
    EmojiModifier = 16,
    IncbExtend = 17,
    IncbLinker = 18,
    IncbConsonant = 19,
}

impl Gcb {
    fn from_table_id(id: u8) -> Gcb {
        match id {
            0 => Gcb::Other,
            1 => Gcb::Control,
            2 => Gcb::Prepend,
            3 => Gcb::Cr,
            4 => Gcb::Lf,
            5 => Gcb::RegionalIndicator,
            6 => Gcb::SpacingMark,
            7 => Gcb::L,
            8 => Gcb::V,
            9 => Gcb::T,
            10 => Gcb::Lv,
            11 => Gcb::Lvt,
            12 => Gcb::Zwj,
            13 => Gcb::Zwnj,
            14 => Gcb::ExtendedPictographic,
            15 => Gcb::EmojiModifierBase,
            16 => Gcb::EmojiModifier,
            17 => Gcb::IncbExtend,
            18 => Gcb::IncbLinker,
            19 => Gcb::IncbConsonant,
            _ => Gcb::Other,
        }
    }
}

pub fn gcb_of(cp: u32) -> Gcb {
    let found = GCB_RANGES.binary_search_by(|&(lo, hi, _)| {
        if hi < cp {
            std::cmp::Ordering::Less
        } else if lo > cp {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    match found {
        Ok(idx) => Gcb::from_table_id(GCB_RANGES[idx].2),
        Err(_) => Gcb::Other,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum BreakState {
    #[default]
    Default,
    RegionalIndicator,
    ExtendedPictographic,
    IncbConsonant,
    IncbLinker,
}

fn is_extend(gb: Gcb) -> bool {
    matches!(gb, Gcb::Zwnj | Gcb::IncbExtend | Gcb::IncbLinker)
}

fn is_extended_pictographic(gb: Gcb) -> bool {
    matches!(gb, Gcb::ExtendedPictographic | Gcb::EmojiModifierBase)
}

fn is_incb_extend(gb: Gcb) -> bool {
    matches!(gb, Gcb::IncbExtend | Gcb::Zwj)
}

/// uucode `computeGraphemeBreak(gb1, gb2, state)`.
pub fn is_break(gb1: Gcb, gb2: Gcb, state: &mut BreakState) -> bool {
    // Reset state when gb1/gb2 fall out of the tracked sequence.
    match *state {
        BreakState::RegionalIndicator => {
            if gb1 != Gcb::RegionalIndicator || gb2 != Gcb::RegionalIndicator {
                *state = BreakState::Default;
            }
        }
        BreakState::ExtendedPictographic => {
            let keeps = |gb: Gcb| {
                matches!(
                    gb,
                    Gcb::IncbExtend
                        | Gcb::IncbLinker
                        | Gcb::Zwnj
                        | Gcb::Zwj
                        | Gcb::ExtendedPictographic
                        | Gcb::EmojiModifierBase
                        | Gcb::EmojiModifier
                )
            };
            if !keeps(gb1) || !keeps(gb2) {
                *state = BreakState::Default;
            }
        }
        BreakState::IncbConsonant | BreakState::IncbLinker => {
            let keeps = |gb: Gcb| {
                matches!(
                    gb,
                    Gcb::IncbConsonant | Gcb::IncbLinker | Gcb::IncbExtend | Gcb::Zwj
                )
            };
            if !keeps(gb1) || !keeps(gb2) {
                *state = BreakState::Default;
            }
        }
        BreakState::Default => {}
    }

    // GB3: CR x LF
    if gb1 == Gcb::Cr && gb2 == Gcb::Lf {
        return false;
    }
    // GB4 / GB5: Control
    if matches!(gb1, Gcb::Control | Gcb::Cr | Gcb::Lf) {
        return true;
    }
    if matches!(gb2, Gcb::Control | Gcb::Cr | Gcb::Lf) {
        return true;
    }
    // GB6-GB8: Hangul
    if gb1 == Gcb::L && matches!(gb2, Gcb::L | Gcb::V | Gcb::Lv | Gcb::Lvt) {
        return false;
    }
    if matches!(gb1, Gcb::Lv | Gcb::V) && matches!(gb2, Gcb::V | Gcb::T) {
        return false;
    }
    if matches!(gb1, Gcb::Lvt | Gcb::T) && gb2 == Gcb::T {
        return false;
    }
    // GB9a: SpacingMark; GB9b: Prepend
    if gb2 == Gcb::SpacingMark {
        return false;
    }
    if gb1 == Gcb::Prepend {
        return false;
    }
    // GB9c: Indic conjunct break
    if gb1 == Gcb::IncbConsonant {
        if is_incb_extend(gb2) {
            *state = BreakState::IncbConsonant;
            return false;
        } else if gb2 == Gcb::IncbLinker {
            *state = BreakState::IncbLinker;
            return false;
        }
    } else if *state == BreakState::IncbConsonant {
        if gb2 == Gcb::IncbLinker {
            *state = BreakState::IncbLinker;
            return false;
        } else if is_incb_extend(gb2) {
            return false;
        } else {
            *state = BreakState::Default;
        }
    } else if *state == BreakState::IncbLinker {
        if gb2 == Gcb::IncbLinker || is_incb_extend(gb2) {
            return false;
        } else if gb2 == Gcb::IncbConsonant {
            *state = BreakState::Default;
            return false;
        } else {
            *state = BreakState::Default;
        }
    }
    // GB11: Emoji ZWJ sequence and emoji modifier sequence (UTS #51)
    if is_extended_pictographic(gb1) {
        if is_extend(gb2) || gb2 == Gcb::Zwj {
            *state = BreakState::ExtendedPictographic;
            return false;
        }
        if gb1 == Gcb::EmojiModifierBase && gb2 == Gcb::EmojiModifier {
            *state = BreakState::ExtendedPictographic;
            return false;
        }
    } else if *state == BreakState::ExtendedPictographic {
        if (is_extend(gb1) || gb1 == Gcb::EmojiModifier) && (is_extend(gb2) || gb2 == Gcb::Zwj) {
            return false;
        } else if gb1 == Gcb::Zwj && is_extended_pictographic(gb2) {
            *state = BreakState::Default;
            return false;
        } else {
            *state = BreakState::Default;
        }
    }
    // GB12 / GB13: Regional indicator pairs
    if gb1 == Gcb::RegionalIndicator && gb2 == Gcb::RegionalIndicator {
        if *state == BreakState::Default {
            *state = BreakState::RegionalIndicator;
            return false;
        } else {
            *state = BreakState::Default;
            return true;
        }
    }
    // GB9: x (Extend | ZWJ)
    if is_extend(gb2) || gb2 == Gcb::Zwj {
        return false;
    }
    // GB999
    true
}

/// Zig `isGraphemeBreak` (utf8.zig) for the wcwidth/unicode modes: validity
/// guards around the uucode machine. Invalid codepoints (U+FFFD or beyond
/// U+10FFFF) always break and leave the state untouched.
pub fn is_grapheme_break(prev: Option<u32>, curr: u32, state: &mut BreakState) -> bool {
    let valid = |cp: u32| cp != 0xFFFD && cp <= 0x10FFFF;
    let Some(prev) = prev else { return true };
    if !valid(curr) || !valid(prev) {
        return true;
    }
    is_break(gcb_of(prev), gcb_of(curr), state)
}
