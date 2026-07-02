//! GraphemePool + GraphemeTracker — transliterated from the Zig reference
//! (`grapheme.zig`, opentui v0.4.1).
//!
//! Ids are 26-bit: 3-bit size class | 7-bit generation | 16-bit slot.
//! Size classes hold 8/16/32/64/128 bytes with LIFO free lists grown one page
//! at a time (256/128/64/16/8 slots per page, pushed in ascending slot order,
//! so a fresh page allocates its HIGHEST slot first). Generations start at 0
//! and increment (mod 128) when a slot is (re)allocated. Live byte strings are
//! interned: allocating bytes that match a live (refcount > 0) entry returns
//! the existing id — this is what makes id streams deterministic and lets the
//! differential harness byte-compare char planes across implementations.

use std::collections::HashMap;

pub const GRAPHEME_ID_MASK: u32 = 0x03FF_FFFF;
const GENERATION_BITS: u32 = 7;
const SLOT_BITS: u32 = 16;
const GENERATION_MASK: u32 = (1 << GENERATION_BITS) - 1;
const SLOT_MASK: u32 = (1 << SLOT_BITS) - 1;
const CLASS_SIZES: [usize; 5] = [8, 16, 32, 64, 128];
const SLOTS_PER_PAGE: [u32; 5] = [256, 128, 64, 16, 8];

struct Slot {
    bytes: Vec<u8>,
    refcount: u32,
    generation: u32,
    allocated: bool,
}

struct ClassPool {
    slots: Vec<Slot>,
    free_list: Vec<u32>,
    slots_per_page: u32,
    capacity: usize,
}

impl ClassPool {
    fn new(capacity: usize, slots_per_page: u32) -> ClassPool {
        ClassPool {
            slots: Vec::new(),
            free_list: Vec::new(),
            slots_per_page,
            capacity,
        }
    }

    fn grow(&mut self) -> bool {
        let base = self.slots.len() as u32;
        if base > SLOT_MASK + 1 - self.slots_per_page {
            return false;
        }
        for i in 0..self.slots_per_page {
            self.slots.push(Slot {
                bytes: Vec::new(),
                refcount: 0,
                generation: 0,
                allocated: false,
            });
            self.free_list.push(base + i);
        }
        true
    }

    fn alloc(&mut self, bytes: &[u8]) -> Option<u32> {
        if bytes.len() > self.capacity {
            return None;
        }
        if self.free_list.is_empty() && !self.grow() {
            return None;
        }
        let index = self.free_list.pop()?;
        let slot = &mut self.slots[index as usize];
        debug_assert!(slot.refcount == 0 && !slot.allocated);
        slot.generation = (slot.generation + 1) & GENERATION_MASK;
        slot.bytes = bytes.to_vec();
        slot.refcount = 0;
        slot.allocated = true;
        Some(index)
    }

    fn slot_checked(&mut self, index: u32, generation: u32) -> Option<&mut Slot> {
        let slot = self.slots.get_mut(index as usize)?;
        if slot.generation != generation || !slot.allocated {
            return None;
        }
        Some(slot)
    }
}

pub struct GraphemePool {
    classes: [ClassPool; 5],
    interned: HashMap<Vec<u8>, u32>,
}

fn class_for_size(size: usize) -> usize {
    if size <= 8 {
        0
    } else if size <= 16 {
        1
    } else if size <= 32 {
        2
    } else if size <= 64 {
        3
    } else {
        4
    }
}

fn unpack(id: u32) -> (usize, u32, u32) {
    let class = ((id >> (GENERATION_BITS + SLOT_BITS)) & 0x7) as usize;
    let generation = (id >> SLOT_BITS) & GENERATION_MASK;
    let slot = id & SLOT_MASK;
    (class, generation, slot)
}

impl GraphemePool {
    pub fn new() -> GraphemePool {
        GraphemePool {
            classes: [
                ClassPool::new(CLASS_SIZES[0], SLOTS_PER_PAGE[0]),
                ClassPool::new(CLASS_SIZES[1], SLOTS_PER_PAGE[1]),
                ClassPool::new(CLASS_SIZES[2], SLOTS_PER_PAGE[2]),
                ClassPool::new(CLASS_SIZES[3], SLOTS_PER_PAGE[3]),
                ClassPool::new(CLASS_SIZES[4], SLOTS_PER_PAGE[4]),
            ],
            interned: HashMap::new(),
        }
    }

    fn lookup_or_invalidate(&mut self, bytes: &[u8]) -> Option<u32> {
        let id = *self.interned.get(bytes)?;
        let (class, generation, slot) = unpack(id);
        let valid = self.classes[class]
            .slot_checked(slot, generation)
            .is_some_and(|s| s.refcount > 0 && s.bytes == bytes);
        if !valid {
            self.interned.remove(bytes);
            return None;
        }
        Some(id)
    }

    pub fn alloc(&mut self, bytes: &[u8]) -> Option<u32> {
        if bytes.len() > CLASS_SIZES[4] {
            return None;
        }
        if let Some(live) = self.lookup_or_invalidate(bytes) {
            return Some(live);
        }
        let class = class_for_size(bytes.len());
        let slot = self.classes[class].alloc(bytes)?;
        let generation = self.classes[class].slots[slot as usize].generation;
        let id = ((class as u32) << (GENERATION_BITS + SLOT_BITS))
            | ((generation & GENERATION_MASK) << SLOT_BITS)
            | (slot & SLOT_MASK);
        debug_assert!(id & !GRAPHEME_ID_MASK == 0);
        Some(id)
    }

    pub fn incref(&mut self, id: u32) {
        let (class, generation, slot) = unpack(id);
        let bytes_to_intern: Option<Vec<u8>> = {
            let Some(s) = self.classes[class].slot_checked(slot, generation) else {
                return;
            };
            if s.refcount == 0 {
                Some(s.bytes.clone())
            } else {
                None
            }
        };
        // Intern on first live reference (Zig interns before publishing).
        if let Some(bytes) = bytes_to_intern {
            if self.lookup_or_invalidate(&bytes).is_none() {
                self.interned.insert(bytes, id);
            }
        }
        if let Some(s) = self.classes[class].slot_checked(slot, generation) {
            s.refcount += 1;
        }
    }

    pub fn decref(&mut self, id: u32) {
        let (class, generation, slot) = unpack(id);
        let mut freed_bytes: Option<Vec<u8>> = None;
        {
            let Some(s) = self.classes[class].slot_checked(slot, generation) else {
                return;
            };
            if s.refcount == 0 {
                return;
            }
            s.refcount -= 1;
            if s.refcount == 0 {
                freed_bytes = Some(std::mem::take(&mut s.bytes));
                s.allocated = false;
                self.classes[class].free_list.push(slot);
            }
        }
        if let Some(bytes) = freed_bytes {
            if self.interned.get(&bytes) == Some(&id) {
                self.interned.remove(&bytes);
            }
        }
    }

    pub fn get(&mut self, id: u32) -> Option<&[u8]> {
        let (class, generation, slot) = unpack(id);
        self.classes[class]
            .slot_checked(slot, generation)
            .map(|s| s.bytes.as_slice())
    }
}

impl Default for GraphemePool {
    fn default() -> GraphemePool {
        GraphemePool::new()
    }
}

/// Per-buffer id -> cell count; holds one pool reference per distinct id.
#[derive(Default)]
pub struct GraphemeTracker {
    used_ids: HashMap<u32, u32>,
}

impl GraphemeTracker {
    pub fn clear(&mut self, pool: &mut GraphemePool) {
        for id in self.used_ids.keys() {
            pool.decref(*id);
        }
        self.used_ids.clear();
    }

    pub fn add(&mut self, pool: &mut GraphemePool, id: u32) {
        let entry = self.used_ids.entry(id).or_insert(0);
        if *entry == 0 {
            *entry = 1;
            pool.incref(id);
        } else {
            *entry += 1;
        }
    }

    pub fn remove(&mut self, pool: &mut GraphemePool, id: u32) {
        let Some(count) = self.used_ids.get_mut(&id) else {
            return;
        };
        if *count > 1 {
            *count -= 1;
            return;
        }
        self.used_ids.remove(&id);
        pool.decref(id);
    }

    pub fn replace(&mut self, pool: &mut GraphemePool, old_id: Option<u32>, new_id: Option<u32>) {
        if let (Some(o), Some(n)) = (old_id, new_id) {
            if o == n {
                return;
            }
        }
        if let Some(id) = new_id {
            self.add(pool, id);
        }
        if let Some(id) = old_id {
            self.remove(pool, id);
        }
    }

    pub fn has_any(&self) -> bool {
        !self.used_ids.is_empty()
    }

    pub fn cell_count(&self) -> u32 {
        self.used_ids.values().sum()
    }

    pub fn total_bytes(&self, pool: &mut GraphemePool) -> u32 {
        self.used_ids
            .iter()
            .map(|(&id, &count)| pool.get(id).map_or(0, |b| b.len() as u32) * count)
            .sum()
    }
}
