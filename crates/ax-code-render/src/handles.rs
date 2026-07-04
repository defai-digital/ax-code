//! Generational u32 handle registry — transliterated from the Zig reference
//! (`handles.zig`, opentui v0.4.1): 16-bit slot index + 12-bit generation +
//! 4-bit object kind; slot 0 is reserved so handle 0 is always invalid;
//! generations start at 1 and a slot retires when its generation would wrap.

use std::sync::{Mutex, MutexGuard, OnceLock};

pub const INDEX_BITS: u32 = 16;
pub const GENERATION_BITS: u32 = 12;
const INDEX_MASK: u32 = (1 << INDEX_BITS) - 1;
const GENERATION_MASK: u32 = (1 << GENERATION_BITS) - 1;
const MAX_SLOTS: usize = INDEX_MASK as usize;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Kind {
    Renderer = 0,
    OptimizedBuffer = 1,
    TextBuffer = 2,
    TextBufferView = 3,
    EditBuffer = 4,
    EditorView = 5,
    SyntaxStyle = 6,
    EventSink = 7,
    AudioEngine = 8,
}

struct Slot {
    generation: u32,
    kind: u8,
    alive: bool,
    ptr: usize,
}

impl Default for Slot {
    fn default() -> Slot {
        Slot {
            generation: 1,
            kind: 0,
            alive: false,
            ptr: 0,
        }
    }
}

struct Registry {
    slots: Vec<Slot>,
    free: Vec<u16>,
}

fn registry() -> MutexGuard<'static, Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| {
            Mutex::new(Registry {
                slots: vec![Slot::default()], // slot 0 reserved
                free: Vec::new(),
            })
        })
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn encode(index: u32, generation: u32, kind: Kind) -> u32 {
    ((kind as u32) << (INDEX_BITS + GENERATION_BITS))
        | ((generation & GENERATION_MASK) << INDEX_BITS)
        | (index & INDEX_MASK)
}

pub fn insert(kind: Kind, ptr: usize) -> u32 {
    let mut reg = registry();
    let index = if let Some(free) = reg.free.pop() {
        free as usize
    } else {
        if reg.slots.len() > MAX_SLOTS {
            eprintln!("ax-code-render: handle registry full ({} slots); returning invalid handle", reg.slots.len());
            return 0;
        }
        reg.slots.push(Slot::default());
        reg.slots.len() - 1
    };
    let slot = &mut reg.slots[index];
    slot.kind = kind as u8;
    slot.alive = true;
    slot.ptr = ptr;
    encode(index as u32, slot.generation, kind)
}

fn validate(reg: &Registry, handle: u32, kind: Kind) -> Option<usize> {
    if handle == 0 {
        return None;
    }
    if (handle >> (INDEX_BITS + GENERATION_BITS)) != kind as u32 {
        return None;
    }
    let index = (handle & INDEX_MASK) as usize;
    if index == 0 || index >= reg.slots.len() {
        return None;
    }
    let slot = &reg.slots[index];
    if slot.generation != ((handle >> INDEX_BITS) & GENERATION_MASK)
        || slot.kind != kind as u8
        || !slot.alive
        || slot.ptr == 0
    {
        return None;
    }
    Some(index)
}

/// Resolve a handle to its stored pointer value.
pub fn get(handle: u32, kind: Kind) -> Option<usize> {
    let reg = registry();
    validate(&reg, handle, kind).map(|index| reg.slots[index].ptr)
}

/// Remove a handle, returning its pointer for the caller to free.
pub fn remove(handle: u32, kind: Kind) -> Option<usize> {
    let mut reg = registry();
    let index = validate(&reg, handle, kind)?;
    let ptr = reg.slots[index].ptr;
    let slot = &mut reg.slots[index];
    slot.ptr = 0;
    slot.kind = 0;
    slot.alive = false;
    let next = slot.generation + 1;
    if next <= GENERATION_MASK {
        slot.generation = next;
        let idx16 = index as u16;
        reg.free.push(idx16);
    } // else: slot retires (never reused), matching the Zig registry
    Some(ptr)
}
