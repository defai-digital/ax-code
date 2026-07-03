//! ADR-046 Slice C2 — MemRegistry, ported from the Zig reference
//! (`mem-registry.zig`, opentui v0.4.1).
//!
//! Slots hold either owned byte buffers or borrowed views of external
//! (JS-provided) memory. Ids are u8 (max 255 buffers), slots are reused
//! LIFO after unregister, and `replace` swaps a slot's contents in place.
//! Borrowed slots read the external memory at `get` time — the JS side owns
//! the lifetime, matching the reference's raw-slice semantics.

pub enum MemBuffer {
    Owned(Vec<u8>),
    /// Borrowed external memory (address + length). Safety: the JS caller
    /// guarantees the allocation outlives its registration, exactly as it
    /// must for the Zig library.
    External {
        ptr: usize,
        len: usize,
    },
}

struct Slot {
    buffer: MemBuffer,
    active: bool,
}

#[derive(Default)]
pub struct MemRegistry {
    slots: Vec<Slot>,
    free_slots: Vec<u8>,
}

impl MemRegistry {
    pub fn new() -> MemRegistry {
        MemRegistry::default()
    }

    pub fn register(&mut self, buffer: MemBuffer) -> Option<u8> {
        if let Some(id) = self.free_slots.pop() {
            self.slots[id as usize] = Slot {
                buffer,
                active: true,
            };
            return Some(id);
        }
        if self.slots.len() >= 255 {
            return None;
        }
        let id = self.slots.len() as u8;
        self.slots.push(Slot {
            buffer,
            active: true,
        });
        Some(id)
    }

    pub fn get(&self, id: u8) -> Option<&[u8]> {
        let slot = self.slots.get(id as usize)?;
        if !slot.active {
            return None;
        }
        Some(match &slot.buffer {
            MemBuffer::Owned(data) => data.as_slice(),
            MemBuffer::External { ptr, len } => unsafe {
                std::slice::from_raw_parts(*ptr as *const u8, *len)
            },
        })
    }

    pub fn replace(&mut self, id: u8, buffer: MemBuffer) -> bool {
        match self.slots.get_mut(id as usize) {
            Some(slot) if slot.active => {
                slot.buffer = buffer;
                true
            }
            _ => false,
        }
    }

    pub fn unregister(&mut self, id: u8) -> bool {
        match self.slots.get_mut(id as usize) {
            Some(slot) if slot.active => {
                slot.buffer = MemBuffer::Owned(Vec::new());
                slot.active = false;
                self.free_slots.push(id);
                true
            }
            _ => false,
        }
    }

    pub fn clear(&mut self) {
        self.slots.clear();
        self.free_slots.clear();
    }

    pub fn used_slots(&self) -> usize {
        self.slots.iter().filter(|s| s.active).count()
    }
}
