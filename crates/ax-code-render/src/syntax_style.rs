//! ADR-046 Slice C4b — syntax style registry, ported from the Zig reference
//! (`syntax-style.zig`, opentui v0.4.1). Names map to stable u32 ids starting
//! at 1 (0 = invalid); re-registering a name overwrites its definition and
//! keeps the id.

use crate::buffer::Rgba;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StyleDefinition {
    pub fg: Option<Rgba>,
    pub bg: Option<Rgba>,
    pub attributes: u32,
}

pub struct SyntaxStyle {
    name_to_id: HashMap<String, u32>,
    id_to_style: HashMap<u32, StyleDefinition>,
    next_id: u32,
}

impl SyntaxStyle {
    pub fn new() -> SyntaxStyle {
        SyntaxStyle {
            name_to_id: HashMap::new(),
            id_to_style: HashMap::new(),
            next_id: 1,
        }
    }

    pub fn register(&mut self, name: &str, definition: StyleDefinition) -> u32 {
        if let Some(&existing) = self.name_to_id.get(name) {
            self.id_to_style.insert(existing, definition);
            return existing;
        }
        let id = self.next_id;
        self.next_id += 1;
        self.name_to_id.insert(name.to_string(), id);
        self.id_to_style.insert(id, definition);
        id
    }

    pub fn resolve_by_name(&self, name: &str) -> Option<u32> {
        self.name_to_id.get(name).copied()
    }

    pub fn resolve_by_id(&self, id: u32) -> Option<StyleDefinition> {
        self.id_to_style.get(&id).copied()
    }

    pub fn style_count(&self) -> u32 {
        self.id_to_style.len() as u32
    }
}

impl Default for SyntaxStyle {
    fn default() -> SyntaxStyle {
        SyntaxStyle::new()
    }
}
