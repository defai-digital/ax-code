//! ADR-046 Slice C1 — generic rope, ported from the Zig reference
//! (`rope.zig`, opentui v0.4.1).
//!
//! Persistent (structurally shared) binary rope with one item per leaf and
//! aggregated metrics: item count, tree depth, item-defined custom metrics
//! (with an optional weight override used by all *ByWeight operations), and
//! per-marker-tag counts. Undo/redo stores root snapshots with metadata —
//! cheap because nodes are immutable and shared. Internal tree shape is NOT
//! part of the parity contract (only traversal order, metrics, markers, and
//! undo semantics are observable through the FFI surface), so balancing here
//! follows the same 3/4-weight criterion but rebuilds may differ.

use std::rc::Rc;

/// Item stored in the rope. `MARKER_COUNT` marker tags at most 4.
pub trait RopeItem: Clone {
    type Metrics: Default + Clone + Copy;
    const MARKER_COUNT: usize;

    fn measure(&self) -> Self::Metrics;
    fn metrics_add(dst: &mut Self::Metrics, src: &Self::Metrics);
    /// Weight contribution of custom metrics; `None` means "use item count".
    fn metrics_weight(m: &Self::Metrics) -> Option<u32>;
    /// Which marker slot this item occupies, if any.
    fn marker_slot(&self) -> Option<usize>;

    /// Ends invariant (Zig `rewriteEnds`), applied after every mutation:
    /// returns items to PREPEND when the first item is unacceptable, and/or
    /// edge deletions. Default: no invariant.
    fn rewrite_ends(_first: Option<&Self>, _last: Option<&Self>) -> RopeBoundary<Self>
    where
        Self: Sized,
    {
        RopeBoundary::default()
    }

    /// Seam invariant (Zig `rewriteBoundary`), applied when two partitions are
    /// joined by a *ByWeight edit. Default: no rewrite.
    fn rewrite_boundary(_left: Option<&Self>, _right: Option<&Self>) -> RopeBoundary<Self>
    where
        Self: Sized,
    {
        RopeBoundary::default()
    }

    /// Whether two adjacent items can merge at a join seam (Zig `canMerge`).
    fn can_merge(_left: &Self, _right: &Self) -> bool {
        false
    }

    /// Merge two mergeable adjacent items (Zig `merge`).
    fn merge(left: &Self, _right: &Self) -> Self {
        left.clone()
    }

    /// The sentinel "empty leaf" a split produces for an empty partition. It
    /// participates in seam boundary rewrites (Zig's `empty_leaf`) but is not
    /// materialized in the output. `None` means the type has no sentinel and
    /// empty partitions skip the rewrite.
    fn sentinel() -> Option<Self>
    where
        Self: Sized,
    {
        None
    }
}

/// Boundary action returned by the ends/seam rewrite hooks.
pub struct RopeBoundary<T> {
    pub delete_left: bool,
    pub delete_right: bool,
    pub insert_between: Vec<T>,
}

impl<T> Default for RopeBoundary<T> {
    fn default() -> RopeBoundary<T> {
        RopeBoundary {
            delete_left: false,
            delete_right: false,
            insert_between: Vec::new(),
        }
    }
}

pub struct Metrics<T: RopeItem> {
    pub count: u32,
    pub depth: u32,
    pub custom: T::Metrics,
    pub marker_counts: [u32; 4],
}

impl<T: RopeItem> Clone for Metrics<T> {
    fn clone(&self) -> Metrics<T> {
        *self
    }
}
impl<T: RopeItem> Copy for Metrics<T> {}

impl<T: RopeItem> Default for Metrics<T> {
    fn default() -> Metrics<T> {
        Metrics {
            count: 0,
            depth: 1,
            custom: T::Metrics::default(),
            marker_counts: [0; 4],
        }
    }
}

impl<T: RopeItem> Metrics<T> {
    fn add(&mut self, other: &Metrics<T>) {
        self.count += other.count;
        self.depth = self.depth.max(other.depth);
        T::metrics_add(&mut self.custom, &other.custom);
        for i in 0..T::MARKER_COUNT {
            self.marker_counts[i] += other.marker_counts[i];
        }
    }

    pub fn weight(&self) -> u32 {
        T::metrics_weight(&self.custom).unwrap_or(self.count)
    }
}

pub enum Node<T: RopeItem> {
    Branch {
        left: Rc<Node<T>>,
        right: Rc<Node<T>>,
        left_metrics: Metrics<T>,
        total_metrics: Metrics<T>,
    },
    Leaf {
        data: Option<T>, // None = sentinel (empty rope placeholder)
    },
}

impl<T: RopeItem> Node<T> {
    fn leaf(data: T) -> Rc<Node<T>> {
        Rc::new(Node::Leaf { data: Some(data) })
    }

    fn sentinel() -> Rc<Node<T>> {
        Rc::new(Node::Leaf { data: None })
    }

    fn metrics(&self) -> Metrics<T> {
        match self {
            Node::Branch { total_metrics, .. } => *total_metrics,
            Node::Leaf { data: None } => Metrics::default(),
            Node::Leaf { data: Some(d) } => {
                let mut m = Metrics {
                    count: 1,
                    depth: 1,
                    custom: d.measure(),
                    marker_counts: [0; 4],
                };
                if let Some(slot) = d.marker_slot() {
                    m.marker_counts[slot] = 1;
                }
                m
            }
        }
    }

    fn branch(left: Rc<Node<T>>, right: Rc<Node<T>>) -> Rc<Node<T>> {
        let left_metrics = left.metrics();
        let mut total = left_metrics;
        total.add(&right.metrics());
        total.depth = left_metrics.depth.max(right.metrics().depth) + 1;
        Rc::new(Node::Branch {
            left,
            right,
            left_metrics,
            total_metrics: total,
        })
    }

    fn is_empty(&self) -> bool {
        self.metrics().count == 0
    }
}

pub struct WeightFind<'a, T: RopeItem> {
    pub leaf: &'a T,
    pub start_weight: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct MarkerPosition {
    pub leaf_index: u32,
    pub global_weight: u32,
}

struct UndoNode<T: RopeItem> {
    root: Rc<Node<T>>,
    meta: Vec<u8>,
    next: Option<Rc<UndoNode<T>>>,
}

pub struct Rope<T: RopeItem> {
    root: Rc<Node<T>>,
    version: u64,
    max_undo_depth: Option<usize>,
    undo_history: Option<Rc<UndoNode<T>>>,
    redo_history: Option<Rc<UndoNode<T>>>,
    curr_history: Option<Rc<UndoNode<T>>>,
    undo_depth: usize,
    marker_cache: Vec<Vec<MarkerPosition>>,
    marker_cache_version: u64,
}

/// Splits an item at a given internal weight into (left, right).
pub type LeafSplitFn<T> = dyn Fn(&T, u32) -> Option<(T, T)>;

impl<T: RopeItem> Rope<T> {
    pub fn new() -> Rope<T> {
        let mut rope = Rope {
            root: Node::sentinel(),
            version: 0,
            max_undo_depth: None,
            undo_history: None,
            redo_history: None,
            curr_history: None,
            undo_depth: 0,
            marker_cache: vec![Vec::new(); T::MARKER_COUNT],
            marker_cache_version: u64::MAX,
        };
        rope.apply_ends_invariant();
        rope
    }

    pub fn with_max_undo_depth(mut self, depth: Option<usize>) -> Rope<T> {
        self.max_undo_depth = depth;
        self
    }

    pub fn from_slice(items: &[T]) -> Rope<T> {
        let mut rope = Rope::new();
        rope.root = Self::build_balanced(items);
        rope.apply_ends_invariant();
        rope
    }

    fn build_balanced(items: &[T]) -> Rc<Node<T>> {
        match items.len() {
            0 => Node::sentinel(),
            1 => Node::leaf(items[0].clone()),
            n => {
                let mid = n / 2;
                Node::branch(
                    Self::build_balanced(&items[..mid]),
                    Self::build_balanced(&items[mid..]),
                )
            }
        }
    }

    fn touch(&mut self) {
        self.version += 1;
    }

    /// Zig `applyEndsInvariant`: runs after every mutation (and on init).
    fn apply_ends_invariant(&mut self) {
        let first = self.get(0).cloned();
        let count = self.count();
        let last = if count > 0 {
            self.get(count - 1).cloned()
        } else {
            None
        };
        let action = T::rewrite_ends(first.as_ref(), last.as_ref());
        if action.delete_left && self.count() > 0 {
            let (_, right) = Self::split_at(&self.root, 1);
            self.root = right;
        }
        if action.delete_right && self.count() > 0 {
            let cnt = self.count();
            let (left, _) = Self::split_at(&self.root, cnt - 1);
            self.root = left;
        }
        if !action.insert_between.is_empty() {
            let prefix = Self::build_balanced(&action.insert_between);
            self.root = Self::join(&prefix, &self.root.clone());
        }
    }

    pub fn count(&self) -> u32 {
        self.root.metrics().count
    }

    pub fn total_weight(&self) -> u32 {
        self.root.metrics().weight()
    }

    pub fn metrics(&self) -> Metrics<T> {
        self.root.metrics()
    }

    pub fn get(&self, index: u32) -> Option<&T> {
        fn get_in<T: RopeItem>(node: &Node<T>, index: u32) -> Option<&T> {
            match node {
                Node::Leaf { data: None } => None,
                Node::Leaf { data: Some(d) } => {
                    if index == 0 {
                        Some(d)
                    } else {
                        None
                    }
                }
                Node::Branch {
                    left,
                    right,
                    left_metrics,
                    ..
                } => {
                    if index < left_metrics.count {
                        get_in(left, index)
                    } else {
                        get_in(right, index - left_metrics.count)
                    }
                }
            }
        }
        get_in(&self.root, index)
    }

    /// In-order traversal; the callback returns false to stop early.
    pub fn walk(&self, f: &mut dyn FnMut(&T, u32) -> bool) {
        fn walk_in<T: RopeItem>(
            node: &Node<T>,
            f: &mut dyn FnMut(&T, u32) -> bool,
            index: &mut u32,
        ) -> bool {
            match node {
                Node::Leaf { data: None } => true,
                Node::Leaf { data: Some(d) } => {
                    let keep = f(d, *index);
                    *index += 1;
                    keep
                }
                Node::Branch { left, right, .. } => {
                    if !walk_in(left, f, index) {
                        return false;
                    }
                    walk_in(right, f, index)
                }
            }
        }
        let mut index = 0;
        walk_in(&self.root, f, &mut index);
    }

    /// Traversal starting at item index `start`.
    pub fn walk_from(&self, start: u32, f: &mut dyn FnMut(&T, u32) -> bool) {
        fn walk_in<T: RopeItem>(
            node: &Node<T>,
            start: u32,
            f: &mut dyn FnMut(&T, u32) -> bool,
            index: &mut u32,
        ) -> bool {
            match node {
                Node::Leaf { data: None } => true,
                Node::Leaf { data: Some(d) } => {
                    let keep = if *index >= start { f(d, *index) } else { true };
                    *index += 1;
                    keep
                }
                Node::Branch {
                    left,
                    right,
                    left_metrics,
                    ..
                } => {
                    // Skip whole subtrees left of the start index.
                    if *index + left_metrics.count > start {
                        if !walk_in(left, start, f, index) {
                            return false;
                        }
                    } else {
                        *index += left_metrics.count;
                    }
                    walk_in(right, start, f, index)
                }
            }
        }
        let mut index = 0;
        walk_in(&self.root, start, f, &mut index);
    }

    pub fn to_vec(&self) -> Vec<T> {
        let mut out = Vec::with_capacity(self.count() as usize);
        self.walk(&mut |item, _| {
            out.push(item.clone());
            true
        });
        out
    }

    fn split_at(node: &Rc<Node<T>>, index: u32) -> (Rc<Node<T>>, Rc<Node<T>>) {
        match &**node {
            Node::Leaf { data: None } => (Node::sentinel(), Node::sentinel()),
            Node::Leaf { data: Some(_) } => {
                if index == 0 {
                    (Node::sentinel(), node.clone())
                } else {
                    (node.clone(), Node::sentinel())
                }
            }
            Node::Branch {
                left,
                right,
                left_metrics,
                ..
            } => {
                if index < left_metrics.count {
                    let (a, b) = Self::split_at(left, index);
                    (a, Self::join(&b, right))
                } else {
                    let (a, b) = Self::split_at(right, index - left_metrics.count);
                    (Self::join(left, &a), b)
                }
            }
        }
    }

    fn join(left: &Rc<Node<T>>, right: &Rc<Node<T>>) -> Rc<Node<T>> {
        if left.is_empty() {
            return right.clone();
        }
        if right.is_empty() {
            return left.clone();
        }
        Node::branch(left.clone(), right.clone())
    }

    fn maybe_rebalance(&mut self) {
        let m = self.root.metrics();
        // Same trigger spirit as the reference (max_imbalance = 7): rebuild
        // when the tree is much deeper than a balanced tree would be.
        let ideal = 32 - (m.count.max(1)).leading_zeros();
        if m.depth > ideal + 7 {
            let items = self.to_vec();
            self.root = Self::build_balanced(&items);
        }
    }

    pub fn insert(&mut self, index: u32, data: T) {
        self.insert_slice(index, std::slice::from_ref(&data));
    }

    pub fn insert_slice(&mut self, index: u32, items: &[T]) {
        if items.is_empty() {
            return;
        }
        let index = index.min(self.count());
        let (left, right) = Self::split_at(&self.root, index);
        let mid = Self::build_balanced(items);
        self.root = Self::join(&Self::join(&left, &mid), &right);
        self.apply_ends_invariant();
        self.touch();
        self.maybe_rebalance();
    }

    pub fn delete_range(&mut self, start: u32, end: u32) {
        if start >= end || start >= self.count() {
            return;
        }
        let end = end.min(self.count());
        let (mid_left, right) = Self::split_at(&self.root, end);
        let (left, _) = Self::split_at(&mid_left, start);
        self.root = Self::join(&left, &right);
        self.apply_ends_invariant();
        self.touch();
        self.maybe_rebalance();
    }

    pub fn clear(&mut self) {
        self.root = Node::sentinel();
        self.apply_ends_invariant();
        self.touch();
    }

    pub fn set_items(&mut self, items: &[T]) {
        self.root = Self::build_balanced(items);
        self.apply_ends_invariant();
        self.touch();
    }

    // --- weight-based operations ------------------------------------------------

    pub fn find_by_weight(&self, weight: u32) -> Option<WeightFind<'_, T>> {
        fn find_in<T: RopeItem>(
            node: &Node<T>,
            target: u32,
            current: u32,
        ) -> Option<WeightFind<'_, T>> {
            match node {
                Node::Leaf { data: None } => None,
                Node::Leaf { data: Some(d) } => {
                    let w = node.metrics().weight();
                    if target < current + w {
                        Some(WeightFind {
                            leaf: d,
                            start_weight: current,
                        })
                    } else {
                        None
                    }
                }
                Node::Branch {
                    left,
                    right,
                    left_metrics,
                    ..
                } => {
                    let lw = left_metrics.weight();
                    if target < current + lw {
                        find_in(left, target, current)
                    } else {
                        find_in(right, target, current + lw)
                    }
                }
            }
        }
        find_in(&self.root, weight, 0)
    }

    /// Item index + item-local weight offset for a global weight.
    fn locate_weight(&self, weight: u32) -> (u32, u32) {
        let mut item_index = 0u32;
        let mut acc = 0u32;
        let mut result = (self.count(), 0u32);
        self.walk(&mut |item, _| {
            let mut m = Metrics::<T>::default();
            m.count = 1;
            m.custom = item.measure();
            let w = m.weight();
            if weight < acc + w {
                result = (item_index, weight - acc);
                return false;
            }
            acc += w;
            item_index += 1;
            true
        });
        result
    }

    /// Split the rope at a global weight; self keeps the left part and the
    /// returned rope holds the right part. Items straddling the boundary are
    /// divided with `split_leaf`; zero-weight items sitting exactly on the
    /// boundary stay on the left (weight <= boundary). NOTE: boundary-item
    /// ownership must be re-validated against the Zig reference when the
    /// TextBuffer differential harness lands (C3).
    pub fn split_by_weight(&mut self, weight: u32, split_leaf: &LeafSplitFn<T>) -> Rope<T> {
        let mut left_items: Vec<T> = Vec::new();
        let mut right_items: Vec<T> = Vec::new();
        let mut acc = 0u32;
        self.walk(&mut |item, _| {
            let mut m = Metrics::<T>::default();
            m.count = 1;
            m.custom = item.measure();
            let w = m.weight();
            let (istart, iend) = (acc, acc + w);
            acc = iend;
            if iend <= weight {
                left_items.push(item.clone());
            } else if istart >= weight {
                right_items.push(item.clone());
            } else if let Some((l, r)) = split_leaf(item, weight - istart) {
                left_items.push(l);
                right_items.push(r);
            } else {
                right_items.push(item.clone());
            }
            true
        });
        self.root = Self::build_balanced(&left_items);
        self.touch();
        let mut right = Rope::new();
        right.root = Self::build_balanced(&right_items);
        right
    }

    pub fn delete_range_by_weight(&mut self, start: u32, end: u32, split_leaf: &LeafSplitFn<T>) {
        if start >= end {
            return;
        }
        let items = self.collect_items();
        let (left, rest) = Self::split_at_weight_items(&items, start, split_leaf);
        let (_mid, right) = Self::split_at_weight_items(&rest, end - start, split_leaf);
        let joined = Self::join_with_boundary(left, right);
        self.root = Self::build_balanced(&joined);
        self.apply_ends_invariant();
        self.touch();
        self.maybe_rebalance();
    }

    pub fn insert_slice_by_weight(
        &mut self,
        weight: u32,
        new_items: &[T],
        split_leaf: &LeafSplitFn<T>,
    ) {
        // Zig insertSliceByWeight: split at `weight`, then
        // join_with_boundary(join_with_boundary(left, insert), right).
        let items = self.collect_items();
        let (left, right) = Self::split_at_weight_items(&items, weight, split_leaf);
        let left_joined = Self::join_with_boundary(left, new_items.to_vec());
        let joined = Self::join_with_boundary(left_joined, right);
        self.root = Self::build_balanced(&joined);
        self.apply_ends_invariant();
        self.touch();
        self.maybe_rebalance();
    }

    fn collect_items(&self) -> Vec<T> {
        let mut items = Vec::new();
        self.walk(&mut |item, _| {
            items.push(item.clone());
            true
        });
        items
    }

    /// Zig `split_at_weight` (item-list form): split the item list at `target`
    /// weight into (left, right). A leaf reached with zero remaining target
    /// (i.e. the split falls exactly at its start) goes entirely RIGHT; a leaf
    /// fully within the remaining target goes LEFT; a straddled leaf splits.
    fn split_at_weight_items(items: &[T], target: u32, split_leaf: &LeafSplitFn<T>) -> (Vec<T>, Vec<T>) {
        let mut left: Vec<T> = Vec::new();
        let mut right: Vec<T> = Vec::new();
        let mut remaining = target;
        let mut done = false;
        for item in items {
            if done {
                right.push(item.clone());
                continue;
            }
            if remaining == 0 {
                right.push(item.clone());
                done = true;
                continue;
            }
            let w = T::metrics_weight(&item.measure()).unwrap_or(1);
            if remaining >= w {
                left.push(item.clone());
                remaining -= w;
            } else {
                // 0 < remaining < w: split this leaf
                if let Some((l, r)) = split_leaf(item, remaining) {
                    left.push(l);
                    right.push(r);
                }
                done = true;
            }
        }
        (left, right)
    }

    /// Zig `joinWithBoundary` (item-list form): merge or rewrite the seam
    /// between the tail of `left` and the head of `right`.
    fn join_with_boundary(mut left: Vec<T>, mut right: Vec<T>) -> Vec<T> {
        // Zig models an empty partition as the empty_leaf sentinel, which still
        // participates in the boundary rewrite (e.g. a trailing break + the
        // sentinel materializes a trailing linestart). The sentinel itself is
        // absorbed, not emitted.
        let sentinel = T::sentinel();
        let l_last = left.last().cloned().or_else(|| sentinel.clone());
        let r_first = right.first().cloned().or_else(|| sentinel.clone());
        if let (Some(l), Some(r)) = (left.last().cloned(), right.first().cloned()) {
            if T::can_merge(&l, &r) {
                let merged = T::merge(&l, &r);
                left.pop();
                right.remove(0);
                left.push(merged);
                left.extend(right);
                return left;
            }
        }
        let action = T::rewrite_boundary(l_last.as_ref(), r_first.as_ref());
        // delete_left/right act on real items only (never on the sentinel).
        if action.delete_left && !left.is_empty() {
            left.pop();
        }
        if action.delete_right && !right.is_empty() {
            right.remove(0);
        }
        left.extend(action.insert_between);
        left.extend(right);
        left
    }

    // --- markers ------------------------------------------------------------------

    fn ensure_marker_cache(&mut self) {
        if self.marker_cache_version == self.version {
            return;
        }
        for list in self.marker_cache.iter_mut() {
            list.clear();
        }
        let mut current_leaf = 0u32;
        let mut current_weight = 0u32;
        let mut positions: Vec<Vec<MarkerPosition>> = vec![Vec::new(); T::MARKER_COUNT];
        self.walk(&mut |item, _| {
            if let Some(slot) = item.marker_slot() {
                positions[slot].push(MarkerPosition {
                    leaf_index: current_leaf,
                    global_weight: current_weight,
                });
            }
            let mut m = Metrics::<T>::default();
            m.count = 1;
            m.custom = item.measure();
            current_weight += m.weight();
            current_leaf += 1;
            true
        });
        self.marker_cache = positions;
        self.marker_cache_version = self.version;
    }

    pub fn marker_count(&mut self, slot: usize) -> u32 {
        self.ensure_marker_cache();
        self.marker_cache[slot].len() as u32
    }

    pub fn get_marker(&mut self, slot: usize, occurrence: u32) -> Option<MarkerPosition> {
        self.ensure_marker_cache();
        self.marker_cache[slot].get(occurrence as usize).copied()
    }

    // --- undo / redo ---------------------------------------------------------------

    pub fn store_undo(&mut self, meta: &[u8]) {
        let node = Rc::new(UndoNode {
            root: self.root.clone(),
            meta: meta.to_vec(),
            next: self.undo_history.take(),
        });
        self.undo_history = Some(node);
        self.undo_depth += 1;
        self.curr_history = None;
        // Zig push_redo_branch: a new edit branches the pending redo chain onto
        // the top undo node and clears redo_history. The branches are never
        // restored in this version, so the only observable effect is that redo
        // is invalidated after any new edit.
        self.redo_history = None;
        if let Some(max) = self.max_undo_depth {
            if self.undo_depth > max {
                self.trim_undo(max);
            }
        }
    }

    fn trim_undo(&mut self, max: usize) {
        // Rebuild the chain up to max entries (the reference truncates in place).
        let mut entries = Vec::new();
        let mut cur = self.undo_history.clone();
        while let Some(node) = cur {
            entries.push((node.root.clone(), node.meta.clone()));
            cur = node.next.clone();
            if entries.len() >= max {
                break;
            }
        }
        let mut rebuilt: Option<Rc<UndoNode<T>>> = None;
        for (root, meta) in entries.into_iter().rev() {
            rebuilt = Some(Rc::new(UndoNode {
                root,
                meta,
                next: rebuilt,
            }));
        }
        self.undo_history = rebuilt;
        self.undo_depth = max;
    }

    pub fn can_undo(&self) -> bool {
        self.undo_history.is_some()
    }

    pub fn can_redo(&self) -> bool {
        self.redo_history.is_some() && self.curr_history.is_some()
    }

    /// Returns the undone entry's metadata, or None when there is no history.
    pub fn undo(&mut self, meta: &[u8]) -> Option<Vec<u8>> {
        let r = match self.curr_history.clone() {
            Some(c) => c,
            None => Rc::new(UndoNode {
                root: self.root.clone(),
                meta: meta.to_vec(),
                next: None,
            }),
        };
        let h = self.undo_history.clone()?;
        self.undo_history = h.next.clone();
        self.curr_history = Some(h.clone());
        self.root = h.root.clone();
        self.version += 1;
        let r2 = Rc::new(UndoNode {
            root: r.root.clone(),
            meta: r.meta.clone(),
            next: self.redo_history.take(),
        });
        self.redo_history = Some(r2);
        self.undo_depth = self.undo_depth.saturating_sub(1);
        Some(h.meta.clone())
    }

    pub fn redo(&mut self) -> Option<Vec<u8>> {
        let u = self.curr_history.clone()?;
        let h = self.redo_history.clone()?;
        if !Rc::ptr_eq(&u.root, &self.root) {
            return None;
        }
        self.redo_history = h.next.clone();
        self.curr_history = Some(h.clone());
        self.root = h.root.clone();
        self.version += 1;
        let u2 = Rc::new(UndoNode {
            root: u.root.clone(),
            meta: u.meta.clone(),
            next: self.undo_history.take(),
        });
        self.undo_history = Some(u2);
        self.undo_depth += 1;
        Some(h.meta.clone())
    }

    pub fn clear_history(&mut self) {
        self.undo_history = None;
        self.redo_history = None;
        self.curr_history = None;
        self.undo_depth = 0;
    }
}

impl<T: RopeItem> Default for Rope<T> {
    fn default() -> Rope<T> {
        Rope::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test item mirroring the Segment shape: text with width, or markers.
    #[derive(Clone, Debug, PartialEq)]
    enum Item {
        Text(String, u32), // content, width (weight)
        Brk,
        LineStart,
    }

    #[derive(Default, Clone, Copy)]
    struct ItemMetrics {
        width: u32,
    }

    impl RopeItem for Item {
        type Metrics = ItemMetrics;
        const MARKER_COUNT: usize = 2;

        fn measure(&self) -> ItemMetrics {
            match self {
                Item::Text(_, w) => ItemMetrics { width: *w },
                _ => ItemMetrics { width: 0 },
            }
        }
        fn metrics_add(dst: &mut ItemMetrics, src: &ItemMetrics) {
            dst.width += src.width;
        }
        fn metrics_weight(m: &ItemMetrics) -> Option<u32> {
            Some(m.width)
        }
        fn marker_slot(&self) -> Option<usize> {
            match self {
                Item::Brk => Some(0),
                Item::LineStart => Some(1),
                Item::Text(..) => None,
            }
        }
    }

    fn text(s: &str) -> Item {
        Item::Text(s.to_string(), s.len() as u32)
    }

    fn split_text(item: &Item, offset: u32) -> Option<(Item, Item)> {
        match item {
            Item::Text(s, _) => {
                let off = offset as usize;
                Some((text(&s[..off]), text(&s[off..])))
            }
            _ => None,
        }
    }

    fn contents(rope: &Rope<Item>) -> String {
        let mut out = String::new();
        rope.walk(&mut |item, _| {
            match item {
                Item::Text(s, _) => out.push_str(s),
                Item::Brk => out.push('|'),
                Item::LineStart => out.push('^'),
            }
            true
        });
        out
    }

    #[test]
    fn build_count_walk() {
        let rope = Rope::from_slice(&[text("ab"), Item::Brk, text("cde")]);
        assert_eq!(rope.count(), 3);
        assert_eq!(rope.total_weight(), 5);
        assert_eq!(contents(&rope), "ab|cde");
        assert_eq!(rope.get(0), Some(&text("ab")));
        assert_eq!(rope.get(1), Some(&Item::Brk));
        assert_eq!(rope.get(2), Some(&text("cde")));
        assert_eq!(rope.get(3), None);
    }

    #[test]
    fn insert_delete_by_index() {
        let mut rope = Rope::from_slice(&[text("aa"), text("bb")]);
        rope.insert(1, Item::Brk);
        assert_eq!(contents(&rope), "aa|bb");
        rope.insert(0, text("x"));
        assert_eq!(contents(&rope), "xaa|bb");
        rope.delete_range(1, 3);
        assert_eq!(contents(&rope), "xbb");
        rope.insert_slice(3, &[Item::Brk, text("tail")]);
        assert_eq!(contents(&rope), "xbb|tail");
    }

    #[test]
    fn walk_from_early_stop() {
        let rope = Rope::from_slice(&[text("a"), text("b"), text("c"), text("d")]);
        let mut seen = Vec::new();
        rope.walk_from(2, &mut |item, idx| {
            if let Item::Text(s, _) = item {
                seen.push((s.clone(), idx));
            }
            true
        });
        assert_eq!(seen, vec![("c".to_string(), 2), ("d".to_string(), 3)]);

        let mut count = 0;
        rope.walk(&mut |_, _| {
            count += 1;
            count < 2
        });
        assert_eq!(count, 2);
    }

    #[test]
    fn find_by_weight() {
        let rope = Rope::from_slice(&[text("ab"), Item::Brk, text("cde")]);
        let hit = rope.find_by_weight(0).unwrap();
        assert_eq!(hit.start_weight, 0);
        let hit = rope.find_by_weight(3).unwrap();
        assert_eq!(hit.leaf, &text("cde"));
        assert_eq!(hit.start_weight, 2);
        assert!(rope.find_by_weight(5).is_none());
    }

    #[test]
    fn weight_edits() {
        let mut rope = Rope::from_slice(&[text("hello"), Item::Brk, text("world")]);
        // delete "llowo" (weights 2..7 across the break)
        rope.delete_range_by_weight(2, 7, &split_text);
        assert_eq!(contents(&rope), "herld");

        let mut rope = Rope::from_slice(&[text("hello")]);
        rope.insert_slice_by_weight(2, &[Item::Brk], &split_text);
        assert_eq!(contents(&rope), "he|llo");
        rope.insert_slice_by_weight(0, &[text(">")], &split_text);
        assert_eq!(contents(&rope), ">he|llo");
        let total = rope.total_weight();
        rope.insert_slice_by_weight(total, &[text("<")], &split_text);
        assert_eq!(contents(&rope), ">he|llo<");
    }

    #[test]
    fn markers() {
        let mut rope = Rope::from_slice(&[
            Item::LineStart,
            text("aa"),
            Item::Brk,
            Item::LineStart,
            text("bbb"),
        ]);
        assert_eq!(rope.marker_count(0), 1); // brk
        assert_eq!(rope.marker_count(1), 2); // linestart
        let m = rope.get_marker(1, 1).unwrap();
        assert_eq!(m.leaf_index, 3);
        assert_eq!(m.global_weight, 2);
        assert!(rope.get_marker(0, 1).is_none());

        rope.insert(0, text("zz"));
        assert_eq!(rope.get_marker(1, 0).unwrap().global_weight, 2);
    }

    #[test]
    fn undo_redo() {
        let mut rope = Rope::from_slice(&[text("v1")]);
        rope.store_undo(b"first");
        rope.set_items(&[text("v2")]);
        rope.store_undo(b"second");
        rope.set_items(&[text("v3")]);

        assert!(rope.can_undo());
        assert!(!rope.can_redo());

        let meta = rope.undo(b"current").unwrap();
        assert_eq!(meta, b"second");
        assert_eq!(contents(&rope), "v2");
        assert!(rope.can_redo());

        let meta = rope.undo(b"x").unwrap();
        assert_eq!(meta, b"first");
        assert_eq!(contents(&rope), "v1");

        // Redo replays forward; the entry metadata comes from the snapshot
        // that was current when each undo ran (Zig reuses curr_history).
        let meta = rope.redo().unwrap();
        assert_eq!(meta, b"second");
        assert_eq!(contents(&rope), "v2");
        let meta = rope.redo().unwrap();
        assert_eq!(meta, b"current");
        assert_eq!(contents(&rope), "v3");

        // Editing after undo invalidates redo (root pointer mismatch).
        rope.undo(b"y").unwrap();
        rope.set_items(&[text("v2b")]);
        assert!(rope.redo().is_none());

        rope.clear_history();
        assert!(!rope.can_undo());
        assert!(!rope.can_redo());
    }

    #[test]
    fn undo_depth_trim() {
        let mut rope = Rope::<Item>::new().with_max_undo_depth(Some(2));
        for i in 0..5 {
            rope.set_items(&[text(&format!("v{i}"))]);
            rope.store_undo(format!("m{i}").as_bytes());
        }
        rope.set_items(&[text("final")]);
        assert_eq!(rope.undo(b"c").unwrap(), b"m4");
        assert_eq!(rope.undo(b"c").unwrap(), b"m3");
        assert!(rope.undo(b"c").is_none());
    }

    #[test]
    fn rebalance_keeps_order() {
        let mut rope = Rope::<Item>::new();
        for i in 0..200 {
            rope.insert(rope.count(), text(&format!("{i},")));
        }
        let expected: String = (0..200).map(|i| format!("{i},")).collect();
        assert_eq!(contents(&rope), expected);
        assert!(rope.metrics().depth < 24);
    }
}
