/// Interval representing a code symbol's range in a file.
/// Uses (line, char) coordinates packed into a single i64 for fast comparison.
#[derive(Debug, Clone)]
struct Interval {
  start_line: u32,
  start_char: u32,
  end_line: u32,
  end_char: u32,
  node_id: String,
  kind: String,
  name: String,
}

impl Interval {
  /// Size of the range in a "virtual" metric: (lines * 10000 + chars)
  /// Used to find the "innermost" (smallest) container.
  fn size(&self) -> i64 {
    let lines = self.end_line as i64 - self.start_line as i64;
    let chars = self.end_char as i64 - self.start_char as i64;
    lines * 10000 + chars
  }

  /// Check if position (line, char) falls within this interval (inclusive bounds).
  fn contains(&self, line: u32, char: u32) -> bool {
    if line < self.start_line || line > self.end_line {
      return false;
    }
    if line == self.start_line && char < self.start_char {
      return false;
    }
    if line == self.end_line && char > self.end_char {
      return false;
    }
    true
  }
}

const CONTAINER_KINDS: &[&str] = &["function", "method", "class", "interface", "module"];
const ANONYMOUS_NAMES: &[&str] = &["<function>", "<unknown>", ""];

/// O(log n) interval tree for finding the innermost containing node.
///
/// This is an augmented sorted-intervals approach:
/// intervals are sorted by start position, and we binary search
/// to find candidates, then select the smallest (innermost) container.
#[napi]
pub struct IntervalTree {
  intervals: Vec<Interval>,
  sorted: bool,
}

#[napi]
impl IntervalTree {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      intervals: Vec::new(),
      sorted: false,
    }
  }

  #[napi]
  pub fn insert(
    &mut self,
    start_line: u32,
    start_char: u32,
    end_line: u32,
    end_char: u32,
    node_id: String,
    kind: String,
    name: String,
  ) {
    self.intervals.push(Interval {
      start_line,
      start_char,
      end_line,
      end_char,
      node_id,
      kind,
      name,
    });
    self.sorted = false;
  }

  /// Find the innermost named container node at the given position.
  /// Returns the node_id of the smallest container, or None.
  #[napi]
  pub fn find_innermost_container(&mut self, line: u32, char: u32) -> Option<String> {
    if !self.sorted {
      self.intervals.sort_by(|a, b| {
        a.start_line.cmp(&b.start_line)
          .then(a.start_char.cmp(&b.start_char))
      });
      self.sorted = true;
    }

    let mut best: Option<&Interval> = None;
    let mut best_size = i64::MAX;

    // Binary search for first interval that could contain (line, char)
    // Any containing interval must start at or before (line, char)
    let search_idx = self.intervals.partition_point(|iv| {
      iv.start_line < line || (iv.start_line == line && iv.start_char <= char)
    });

    // Check intervals from 0..search_idx (all start at or before our point)
    for iv in &self.intervals[..search_idx] {
      if !iv.contains(line, char) {
        continue;
      }
      if !CONTAINER_KINDS.contains(&iv.kind.as_str()) {
        continue;
      }
      if ANONYMOUS_NAMES.contains(&iv.name.as_str()) {
        continue;
      }
      let sz = iv.size();
      if sz < best_size {
        best_size = sz;
        best = Some(iv);
      }
    }

    best.map(|iv| iv.node_id.clone())
  }

  /// Find the innermost container of any kind (including non-container kinds).
  /// Used for lookup_caller_kind.
  #[napi]
  pub fn find_innermost_node(&mut self, line: u32, char: u32) -> Option<String> {
    if !self.sorted {
      self.intervals.sort_by(|a, b| {
        a.start_line.cmp(&b.start_line)
          .then(a.start_char.cmp(&b.start_char))
      });
      self.sorted = true;
    }

    let mut best: Option<&Interval> = None;
    let mut best_size = i64::MAX;

    let search_idx = self.intervals.partition_point(|iv| {
      iv.start_line < line || (iv.start_line == line && iv.start_char <= char)
    });

    for iv in &self.intervals[..search_idx] {
      if !iv.contains(line, char) {
        continue;
      }
      let sz = iv.size();
      if sz < best_size {
        best_size = sz;
        best = Some(iv);
      }
    }

    best.map(|iv| iv.node_id.clone())
  }

  /// Get the kind of a node by ID
  #[napi]
  pub fn get_node_kind(&self, node_id: String) -> Option<String> {
    self.intervals.iter()
      .find(|iv| iv.node_id == node_id)
      .map(|iv| iv.kind.clone())
  }

  #[napi]
  pub fn clear(&mut self) {
    self.intervals.clear();
    self.sorted = false;
  }

  #[napi]
  pub fn len(&self) -> u32 {
    self.intervals.len() as u32
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_find_innermost_container() {
    let mut tree = IntervalTree::new();

    // Module: lines 0-100
    tree.insert(0, 0, 100, 0, "mod1".into(), "module".into(), "MyModule".into());
    // Class inside module: lines 5-80
    tree.insert(5, 0, 80, 0, "cls1".into(), "class".into(), "MyClass".into());
    // Method inside class: lines 10-30
    tree.insert(10, 0, 30, 0, "fn1".into(), "method".into(), "myMethod".into());
    // Variable inside method (not a container)
    tree.insert(15, 0, 15, 20, "var1".into(), "variable".into(), "x".into());

    // Point inside method -> should return method (innermost container)
    assert_eq!(tree.find_innermost_container(20, 5), Some("fn1".into()));

    // Point inside class but outside method -> should return class
    assert_eq!(tree.find_innermost_container(50, 5), Some("cls1".into()));

    // Point inside module but outside class -> should return module
    assert_eq!(tree.find_innermost_container(90, 5), Some("mod1".into()));

    // Point outside everything
    assert_eq!(tree.find_innermost_container(200, 0), None);
  }

  #[test]
  fn test_anonymous_skipped() {
    let mut tree = IntervalTree::new();

    tree.insert(0, 0, 100, 0, "mod1".into(), "module".into(), "MyModule".into());
    tree.insert(5, 0, 50, 0, "anon".into(), "function".into(), "<function>".into());

    // Should skip anonymous and return module
    assert_eq!(tree.find_innermost_container(25, 0), Some("mod1".into()));
  }

  #[test]
  fn test_empty_tree() {
    let mut tree = IntervalTree::new();
    assert_eq!(tree.find_innermost_container(0, 0), None);
  }
}
