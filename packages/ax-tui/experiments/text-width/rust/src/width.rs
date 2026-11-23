// MIT-licensed AX TUI width policy, derived from the OpenTUI fork.
// See the AX TUI LICENSE and the renderer's THIRD_PARTY_LICENSES.txt.

const DATA: &[u8] = include_bytes!("unicode-width.bin");
const CLASS_COUNT: usize = DATA[0] as usize;
const STATE_COUNT: usize = DATA[1] as usize;
const TRANSITION_OFFSET: usize = 2;
const PAGE_INDEX_OFFSET: usize = TRANSITION_OFFSET + CLASS_COUNT * CLASS_COUNT * STATE_COUNT;
const PAGE_SIZE: usize = 256;
const PAGES_OFFSET: usize = PAGE_INDEX_OFFSET + 0x110000 / PAGE_SIZE;
const BREAK_FLAG: u8 = 0x80;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum WidthMethod {
    Unicode,
    Wcwidth,
    NoZwj,
}

#[derive(Clone, Copy)]
struct Properties(u8);

impl Properties {
    fn of(character: char) -> Self {
        let scalar = character as usize;
        let page = usize::from(DATA[PAGE_INDEX_OFFSET + scalar / PAGE_SIZE]);
        Self(DATA[PAGES_OFFSET + page * PAGE_SIZE + scalar % PAGE_SIZE])
    }

    fn width(self, character: char, tab_width: u32) -> u32 {
        if character == '\t' {
            return tab_width;
        }
        u32::from((self.0 >> 5) & 0b11)
    }

    fn class(self) -> usize {
        usize::from(self.0 & 0b1_1111)
    }

    fn is_nonspacing_mark(self) -> bool {
        self.0 & 0x80 != 0
    }
}

fn regional_indicator(character: char) -> bool {
    ('\u{1F1E6}'..='\u{1F1FF}').contains(&character)
}

#[derive(Default)]
struct Cluster {
    width: u32,
    starts_with_regional_indicator: bool,
    has_nonspacing_mark: bool,
}

impl Cluster {
    fn extend(&mut self, character: char, properties: Properties, width: u32) {
        match character {
            '\u{FE0F}' => {
                if self.width == 1 {
                    self.width = 2;
                }
            }
            _ if properties.is_nonspacing_mark() => self.has_nonspacing_mark = true,
            _ if self.starts_with_regional_indicator && regional_indicator(character) => {
                self.width += width;
            }
            _ if self.width == 0 => self.width = width,
            '\u{0915}'..='\u{0939}' | '\u{0958}'..='\u{095F}'
                if self.has_nonspacing_mark && width > 0 =>
            {
                if character != '\u{0930}' {
                    self.width += width;
                }
                self.has_nonspacing_mark = false;
            }
            _ => {}
        }
    }
}

pub(crate) fn measure(text: &str, tab_width: u32, method: WidthMethod) -> u32 {
    if text.bytes().all(|byte| (b' '..=b'~').contains(&byte)) {
        return text.len() as u32;
    }
    if method == WidthMethod::Wcwidth {
        return text
            .chars()
            .map(|character| Properties::of(character).width(character, tab_width))
            .sum();
    }

    let mut total = 0;
    let mut state = 0;
    let mut cluster = Cluster::default();
    let mut previous = None;
    for character in text.chars() {
        let properties = Properties::of(character);
        let width = properties.width(character, tab_width);
        let is_boundary = match previous {
            // The renderer treats U+FFFD as a boundary and preserves the previous
            // break state. In no_zwj mode only a forced break after ZWJ resets it.
            _ if character == '\u{FFFD}' => true,
            Some(('\u{200D}', _)) if method == WidthMethod::NoZwj => {
                state = 0;
                true
            }
            None | Some(('\u{FFFD}', _)) => true,
            Some((_, previous_class)) => {
                let index =
                    (previous_class * CLASS_COUNT + properties.class()) * STATE_COUNT + state;
                let transition = DATA[TRANSITION_OFFSET + index];
                state = usize::from(transition & !BREAK_FLAG);
                transition & BREAK_FLAG != 0
            }
        };
        if is_boundary {
            total += cluster.width;
            cluster = Cluster {
                width,
                starts_with_regional_indicator: regional_indicator(character),
                has_nonspacing_mark: false,
            };
        } else {
            cluster.extend(character, properties, width);
        }
        previous = Some((character, properties.class()));
    }
    total + cluster.width
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unicode_snapshot_covers_every_scalar_and_break_transition() {
        assert!((1..=32).contains(&CLASS_COUNT));
        assert!((1..=128).contains(&STATE_COUNT));
        assert_eq!((DATA.len() - PAGES_OFFSET) % PAGE_SIZE, 0);
        let pages = (DATA.len() - PAGES_OFFSET) / PAGE_SIZE;
        for &page in &DATA[PAGE_INDEX_OFFSET..PAGES_OFFSET] {
            assert!(usize::from(page) < pages);
        }
        for &properties in &DATA[PAGES_OFFSET..] {
            assert!(Properties(properties).class() < CLASS_COUNT);
            assert!((properties >> 5) & 0b11 <= 2);
        }
        for &transition in &DATA[TRANSITION_OFFSET..PAGE_INDEX_OFFSET] {
            assert!(usize::from(transition & !BREAK_FLAG) < STATE_COUNT);
        }
    }
}
