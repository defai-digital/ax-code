#[macro_use]
extern crate napi_derive;

use serde::{Deserialize, Serialize};
use similar::TextDiff;

// ── Unicode normalization helpers ────────────────────────────────────────────

fn normalize_unicode(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  for ch in s.chars() {
    match ch {
      '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => out.push('\''),
      '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => out.push('"'),
      '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}' => {
        out.push('-')
      }
      '\u{2026}' => out.push_str("..."),
      '\u{00A0}' => out.push(' '),
      _ => out.push(ch),
    }
  }
  out
}

// ── Escape normalization ─────────────────────────────────────────────────────

fn unescape_string(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  let mut chars = s.chars().peekable();
  while let Some(ch) = chars.next() {
    if ch == '\\' {
      match chars.peek() {
        Some('n') => {
          chars.next();
          out.push('\n');
        }
        Some('t') => {
          chars.next();
          out.push('\t');
        }
        Some('r') => {
          chars.next();
          out.push('\r');
        }
        Some('\'') => {
          chars.next();
          out.push('\'');
        }
        Some('"') => {
          chars.next();
          out.push('"');
        }
        Some('`') => {
          chars.next();
          out.push('`');
        }
        Some('\\') => {
          chars.next();
          out.push('\\');
        }
        Some('$') => {
          chars.next();
          out.push('$');
        }
        _ => out.push(ch),
      }
    } else {
      out.push(ch);
    }
  }
  out
}

// ── Line helpers ─────────────────────────────────────────────────────────────

/// Compute byte offset of line `idx` in `lines` (each separated by '\n').
fn line_byte_offset(lines: &[&str], idx: usize) -> usize {
  let mut offset = 0;
  for i in 0..idx {
    offset += lines[i].len() + 1; // +1 for '\n'
  }
  offset
}

/// Extract the substring from `content` that spans lines[start..=end].
fn extract_lines<'a>(content: &'a str, lines: &[&str], start: usize, end: usize) -> &'a str {
  let byte_start = line_byte_offset(lines, start);
  let mut byte_end = byte_start;
  for k in start..=end {
    byte_end += lines[k].len();
    if k < end {
      byte_end += 1;
    }
  }
  &content[byte_start..byte_end]
}

// ── Strategies ───────────────────────────────────────────────────────────────

/// Each strategy returns a Vec of candidate match strings found in `content`.
/// The caller checks uniqueness (indexOf == lastIndexOf).

fn strategy_simple(content: &str, find: &str) -> Vec<String> {
  if content.contains(find) {
    vec![find.to_string()]
  } else {
    vec![]
  }
}

fn strategy_line_trimmed(content: &str, find: &str) -> Vec<String> {
  let original_lines: Vec<&str> = content.split('\n').collect();
  let mut search_lines: Vec<&str> = find.split('\n').collect();

  if search_lines.last() == Some(&"") {
    search_lines.pop();
  }

  if search_lines.is_empty() {
    return vec![];
  }

  let mut results = Vec::new();
  if original_lines.len() < search_lines.len() {
    return results;
  }

  for i in 0..=(original_lines.len() - search_lines.len()) {
    let mut matches = true;
    for j in 0..search_lines.len() {
      if original_lines[i + j].trim() != search_lines[j].trim() {
        matches = false;
        break;
      }
    }
    if matches {
      let matched = extract_lines(content, &original_lines, i, i + search_lines.len() - 1);
      results.push(matched.to_string());
    }
  }
  results
}

fn strategy_block_anchor(content: &str, find: &str) -> Vec<String> {
  let original_lines: Vec<&str> = content.split('\n').collect();
  let mut search_lines: Vec<&str> = find.split('\n').collect();

  if search_lines.len() < 3 {
    return vec![];
  }

  if search_lines.last() == Some(&"") {
    search_lines.pop();
  }

  if search_lines.is_empty() {
    return vec![];
  }

  let first_line_search = search_lines[0].trim();
  let last_line_search = search_lines[search_lines.len() - 1].trim();
  let search_block_size = search_lines.len();

  // Collect candidates where both anchors match
  let mut candidates: Vec<(usize, usize)> = Vec::new();
  for i in 0..original_lines.len() {
    if original_lines[i].trim() != first_line_search {
      continue;
    }
    if search_block_size == 1 {
      candidates.push((i, i));
      continue;
    }
    for j in (i + 1)..original_lines.len() {
      if original_lines[j].trim() == last_line_search {
        candidates.push((i, j));
        break;
      }
    }
  }

  if candidates.is_empty() {
    return vec![];
  }

  const SINGLE_CANDIDATE_THRESHOLD: f64 = 0.0;
  const MULTIPLE_CANDIDATES_THRESHOLD: f64 = 0.3;

  if candidates.len() == 1 {
    let (start_line, end_line) = candidates[0];
    let actual_block_size = end_line - start_line + 1;

    let lines_to_check = if search_block_size >= 2 && actual_block_size >= 2 {
      std::cmp::min(search_block_size - 2, actual_block_size - 2)
    } else {
      0
    };

    let sim = if lines_to_check > 0 {
      let mut similarity = 0.0_f64;
      let mut j = 1;
      while j < search_block_size - 1 && j < actual_block_size - 1 {
        let original_line = original_lines[start_line + j].trim();
        let search_line = search_lines[j].trim();
        let max_len = std::cmp::max(original_line.len(), search_line.len());
        if max_len == 0 {
          j += 1;
          continue;
        }
        let distance = strsim::levenshtein(original_line, search_line);
        similarity += (1.0 - distance as f64 / max_len as f64) / lines_to_check as f64;
        if similarity >= SINGLE_CANDIDATE_THRESHOLD {
          break;
        }
        j += 1;
      }
      similarity
    } else {
      1.0
    };

    if sim >= SINGLE_CANDIDATE_THRESHOLD {
      let matched = extract_lines(content, &original_lines, start_line, end_line);
      return vec![matched.to_string()];
    }
    return vec![];
  }

  // Multiple candidates – find the best one
  let mut best_match: Option<(usize, usize)> = None;
  let mut max_similarity: f64 = -1.0;

  for &(start_line, end_line) in &candidates {
    let actual_block_size = end_line - start_line + 1;

    let lines_to_check = if search_block_size >= 2 && actual_block_size >= 2 {
      std::cmp::min(search_block_size - 2, actual_block_size - 2)
    } else {
      0
    };

    let sim = if lines_to_check > 0 {
      let mut similarity = 0.0_f64;
      let mut lines_checked = 0_usize;
      let mut j = 1;
      while j < search_block_size - 1 && j < actual_block_size - 1 {
        let original_line = original_lines[start_line + j].trim();
        let search_line = search_lines[j].trim();
        let max_len = std::cmp::max(original_line.len(), search_line.len());
        if max_len == 0 {
          j += 1;
          continue;
        }
        lines_checked += 1;
        let distance = strsim::levenshtein(original_line, search_line);
        similarity += 1.0 - distance as f64 / max_len as f64;
        j += 1;
      }
      if lines_checked > 0 {
        similarity / lines_checked as f64
      } else {
        1.0
      }
    } else {
      1.0
    };

    if sim > max_similarity {
      max_similarity = sim;
      best_match = Some((start_line, end_line));
    }
  }

  if max_similarity >= MULTIPLE_CANDIDATES_THRESHOLD {
    if let Some((start_line, end_line)) = best_match {
      let matched = extract_lines(content, &original_lines, start_line, end_line);
      return vec![matched.to_string()];
    }
  }

  vec![]
}

fn strategy_whitespace_normalized(content: &str, find: &str) -> Vec<String> {
  fn normalize_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_ws = true; // treat start as whitespace to trim leading
    for ch in s.chars() {
      if ch.is_whitespace() {
        if !prev_ws {
          out.push(' ');
        }
        prev_ws = true;
      } else {
        out.push(ch);
        prev_ws = false;
      }
    }
    // trim trailing space
    if out.ends_with(' ') {
      out.pop();
    }
    out
  }

  let normalized_find = normalize_ws(find);
  let lines: Vec<&str> = content.split('\n').collect();
  let mut results = Vec::new();

  // Single-line matches
  for line in &lines {
    if normalize_ws(line) == normalized_find {
      results.push(line.to_string());
    } else {
      let normalized_line = normalize_ws(line);
      if normalized_line.contains(&normalized_find) {
        // For substring matches, yield the find string itself (like TS when words > 6)
        results.push(find.to_string());
      }
    }
  }

  // Multi-line matches
  let find_lines: Vec<&str> = find.split('\n').collect();
  if find_lines.len() > 1 && lines.len() >= find_lines.len() {
    for i in 0..=(lines.len() - find_lines.len()) {
      let block: String = lines[i..i + find_lines.len()].join("\n");
      if normalize_ws(&block) == normalized_find {
        results.push(block);
      }
    }
  }

  results
}

fn strategy_indentation_flexible(content: &str, find: &str) -> Vec<String> {
  fn remove_indentation(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let non_empty: Vec<&&str> = lines.iter().filter(|l| !l.trim().is_empty()).collect();
    if non_empty.is_empty() {
      return text.to_string();
    }
    let min_indent = non_empty
      .iter()
      .map(|l| l.len() - l.trim_start().len())
      .min()
      .unwrap_or(0);
    lines
      .iter()
      .map(|l| {
        if l.trim().is_empty() {
          l.to_string()
        } else if l.len() >= min_indent {
          l[min_indent..].to_string()
        } else {
          l.to_string()
        }
      })
      .collect::<Vec<_>>()
      .join("\n")
  }

  let normalized_find = remove_indentation(find);
  let content_lines: Vec<&str> = content.split('\n').collect();
  let find_lines: Vec<&str> = find.split('\n').collect();
  let mut results = Vec::new();

  if content_lines.len() < find_lines.len() {
    return results;
  }

  for i in 0..=(content_lines.len() - find_lines.len()) {
    let block = content_lines[i..i + find_lines.len()].join("\n");
    if remove_indentation(&block) == normalized_find {
      results.push(block);
    }
  }

  results
}

fn strategy_escape_normalized(content: &str, find: &str) -> Vec<String> {
  let unescaped_find = unescape_string(find);

  // Try direct match first
  if content.contains(&unescaped_find) {
    return vec![unescaped_find];
  }

  // Try finding escaped versions in content
  let lines: Vec<&str> = content.split('\n').collect();
  let find_lines: Vec<&str> = unescaped_find.split('\n').collect();
  let mut results = Vec::new();

  if lines.len() >= find_lines.len() {
    for i in 0..=(lines.len() - find_lines.len()) {
      let block = lines[i..i + find_lines.len()].join("\n");
      let unescaped_block = unescape_string(&block);
      if unescaped_block == unescaped_find {
        results.push(block);
      }
    }
  }

  results
}

fn strategy_trimmed_boundary(content: &str, find: &str) -> Vec<String> {
  let trimmed_find = find.trim();
  if trimmed_find == find {
    return vec![];
  }

  let mut results = Vec::new();

  if content.contains(trimmed_find) {
    results.push(trimmed_find.to_string());
  }

  // Also try block matching
  let lines: Vec<&str> = content.split('\n').collect();
  let find_lines: Vec<&str> = find.split('\n').collect();

  if lines.len() >= find_lines.len() {
    for i in 0..=(lines.len() - find_lines.len()) {
      let block = lines[i..i + find_lines.len()].join("\n");
      if block.trim() == trimmed_find {
        results.push(block);
      }
    }
  }

  results
}

fn strategy_context_aware(content: &str, find: &str) -> Vec<String> {
  let mut find_lines: Vec<&str> = find.split('\n').collect();
  if find_lines.len() < 3 {
    return vec![];
  }

  if find_lines.last() == Some(&"") {
    find_lines.pop();
  }

  if find_lines.len() < 2 {
    return vec![];
  }

  let content_lines: Vec<&str> = content.split('\n').collect();
  let first_line = find_lines[0].trim();
  let last_line = find_lines[find_lines.len() - 1].trim();
  let mut results = Vec::new();

  for i in 0..content_lines.len() {
    if content_lines[i].trim() != first_line {
      continue;
    }

    let mut matched = false;
    for j in (i + 1)..content_lines.len() {
      if matched {
        break;
      }
      if content_lines[j].trim() != last_line {
        continue;
      }

      let block_lines = &content_lines[i..=j];
      if block_lines.len() != find_lines.len() {
        continue;
      }

      // Check middle similarity (at least 50%)
      let mut matching_lines = 0_usize;
      let mut total_non_empty = 0_usize;
      for k in 1..block_lines.len() - 1 {
        let block_line = block_lines[k].trim();
        let find_line = find_lines[k].trim();
        if !block_line.is_empty() || !find_line.is_empty() {
          total_non_empty += 1;
          if block_line == find_line {
            matching_lines += 1;
          }
        }
      }

      if total_non_empty == 0 || matching_lines as f64 / total_non_empty as f64 >= 0.5 {
        results.push(block_lines.join("\n"));
        matched = true;
      }
    }
  }

  results
}

fn strategy_multi_occurrence(content: &str, find: &str) -> Vec<String> {
  let mut results = Vec::new();
  let mut start = 0;
  while let Some(idx) = content[start..].find(find) {
    results.push(find.to_string());
    start += idx + find.len();
  }
  results
}

// ── Strategy names ───────────────────────────────────────────────────────────

const STRATEGY_NAMES: &[&str] = &[
  "Simple",
  "LineTrimmed",
  "BlockAnchor",
  "WhitespaceNormalized",
  "IndentationFlexible",
  "EscapeNormalized",
  "TrimmedBoundary",
  "ContextAware",
  "MultiOccurrence",
];

type StrategyFn = fn(&str, &str) -> Vec<String>;

const STRATEGIES: &[StrategyFn] = &[
  strategy_simple,
  strategy_line_trimmed,
  strategy_block_anchor,
  strategy_whitespace_normalized,
  strategy_indentation_flexible,
  strategy_escape_normalized,
  strategy_trimmed_boundary,
  strategy_context_aware,
  strategy_multi_occurrence,
];

// ── Unified diff generation ──────────────────────────────────────────────────

fn generate_unified_diff(file_path: &str, old_content: &str, new_content: &str) -> String {
  let diff = TextDiff::from_lines(old_content, new_content);
  let mut out = String::new();
  out.push_str(&format!("--- {}\n", file_path));
  out.push_str(&format!("+++ {}\n", file_path));
  for hunk in diff.unified_diff().context_radius(3).iter_hunks() {
    out.push_str(&hunk.to_string());
  }
  out
}

// ── Diff stats helper ────────────────────────────────────────────────────────

fn compute_diff_stats(old_content: &str, new_content: &str) -> (u32, u32) {
  let diff = TextDiff::from_lines(old_content, new_content);
  let mut additions: u32 = 0;
  let mut deletions: u32 = 0;
  for change in diff.iter_all_changes() {
    match change.tag() {
      similar::ChangeTag::Insert => additions += 1,
      similar::ChangeTag::Delete => deletions += 1,
      similar::ChangeTag::Equal => {}
    }
  }
  (additions, deletions)
}

// ── NAPI exports ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct EditReplaceResult {
  new_content: String,
  unified_diff: String,
  additions: u32,
  deletions: u32,
  strategy: String,
}

/// Core edit tool function. Tries 9 replacer strategies in order.
///
/// Returns JSON: `{ new_content, unified_diff, additions, deletions, strategy }`
#[napi]
pub fn edit_replace(
  content: String,
  old_string: String,
  new_string: String,
  replace_all: bool,
) -> napi::Result<String> {
  if old_string == new_string {
    return Err(napi::Error::from_reason(
      "No changes to apply: oldString and newString are identical.",
    ));
  }

  if replace_all {
    if !content.contains(&old_string) {
      return Err(napi::Error::from_reason(
        "Could not find oldString in the file. It must match exactly when replaceAll is enabled.",
      ));
    }
    let new_content = content.replace(&old_string, &new_string);
    let diff = generate_unified_diff("file", &content, &new_content);
    let (additions, deletions) = compute_diff_stats(&content, &new_content);
    let result = EditReplaceResult {
      new_content,
      unified_diff: diff,
      additions,
      deletions,
      strategy: "ReplaceAll".to_string(),
    };
    return serde_json::to_string(&result)
      .map_err(|e| napi::Error::from_reason(format!("JSON serialization error: {}", e)));
  }

  let mut not_found = true;

  for (idx, strategy) in STRATEGIES.iter().enumerate() {
    let candidates = strategy(&content, &old_string);
    for search in &candidates {
      let first_idx = content.find(search.as_str());
      if first_idx.is_none() {
        continue;
      }
      not_found = false;
      let first = first_idx.unwrap();
      let last = content.rfind(search.as_str()).unwrap();
      if first != last {
        continue; // not unique
      }
      // Perform the replacement
      let new_content =
        format!("{}{}{}", &content[..first], new_string, &content[first + search.len()..]);
      let diff = generate_unified_diff("file", &content, &new_content);
      let (additions, deletions) = compute_diff_stats(&content, &new_content);
      let result = EditReplaceResult {
        new_content,
        unified_diff: diff,
        additions,
        deletions,
        strategy: STRATEGY_NAMES[idx].to_string(),
      };
      return serde_json::to_string(&result)
        .map_err(|e| napi::Error::from_reason(format!("JSON serialization error: {}", e)));
    }
  }

  if not_found {
    Err(napi::Error::from_reason(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    ))
  } else {
    Err(napi::Error::from_reason(
      "Found multiple matches for oldString. Provide more surrounding context to make the match unique.",
    ))
  }
}

// ── seek_sequence ────────────────────────────────────────────────────────────

fn try_match<F>(lines: &[&str], pattern: &[&str], start_index: usize, compare: F, eof: bool) -> i32
where
  F: Fn(&str, &str) -> bool,
{
  if pattern.is_empty() || lines.len() < pattern.len() {
    return -1;
  }

  // If EOF anchor, try from end first
  if eof {
    let from_end = lines.len() - pattern.len();
    if from_end >= start_index {
      let mut matches = true;
      for j in 0..pattern.len() {
        if !compare(lines[from_end + j], pattern[j]) {
          matches = false;
          break;
        }
      }
      if matches {
        return from_end as i32;
      }
    }
  }

  // Forward search
  for i in start_index..=(lines.len() - pattern.len()) {
    let mut matches = true;
    for j in 0..pattern.len() {
      if !compare(lines[i + j], pattern[j]) {
        matches = false;
        break;
      }
    }
    if matches {
      return i as i32;
    }
  }

  -1
}

fn seek_sequence_impl(lines: &[&str], pattern: &[&str], start_index: usize, eof: bool) -> i32 {
  if pattern.is_empty() {
    return -1;
  }

  // Pass 1: exact
  let exact = try_match(lines, pattern, start_index, |a, b| a == b, eof);
  if exact != -1 {
    return exact;
  }

  // Pass 2: right-strip
  let rstrip = try_match(
    lines,
    pattern,
    start_index,
    |a, b| a.trim_end() == b.trim_end(),
    eof,
  );
  if rstrip != -1 {
    return rstrip;
  }

  // Pass 3: full trim
  let trimmed = try_match(
    lines,
    pattern,
    start_index,
    |a, b| a.trim() == b.trim(),
    eof,
  );
  if trimmed != -1 {
    return trimmed;
  }

  // Pass 4: unicode normalized + trim
  try_match(
    lines,
    pattern,
    start_index,
    |a, b| normalize_unicode(a.trim()) == normalize_unicode(b.trim()),
    eof,
  )
}

/// 4-pass fuzzy line matching.
/// Returns the index of the first match, or -1.
#[napi]
pub fn seek_sequence(
  lines: Vec<String>,
  pattern: Vec<String>,
  start_index: i32,
  eof: bool,
) -> i32 {
  let lines_ref: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
  let pattern_ref: Vec<&str> = pattern.iter().map(|s| s.as_str()).collect();
  seek_sequence_impl(
    &lines_ref,
    &pattern_ref,
    start_index.max(0) as usize,
    eof,
  )
}

/// Generate a unified diff between two strings.
#[napi]
pub fn unified_diff(file_path: String, old_content: String, new_content: String) -> String {
  generate_unified_diff(&file_path, &old_content, &new_content)
}

/// Count additions and deletions.
/// Returns JSON: `{ additions, deletions }`
#[napi]
pub fn diff_stats(old_content: String, new_content: String) -> napi::Result<String> {
  let (additions, deletions) = compute_diff_stats(&old_content, &new_content);

  #[derive(Serialize)]
  struct Stats {
    additions: u32,
    deletions: u32,
  }

  serde_json::to_string(&Stats {
    additions,
    deletions,
  })
  .map_err(|e| napi::Error::from_reason(format!("JSON serialization error: {}", e)))
}

/// Levenshtein edit distance.
/// BUG-301: Return f64 to avoid truncating usize on very long strings
#[napi]
pub fn levenshtein(a: String, b: String) -> f64 {
  strsim::levenshtein(&a, &b) as f64
}

/// Normalized string similarity (0.0 - 1.0).
#[napi]
pub fn similarity(a: String, b: String) -> f64 {
  strsim::normalized_levenshtein(&a, &b)
}

// ── apply_chunks ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PatchChunk {
  old_lines: Vec<String>,
  new_lines: Vec<String>,
  change_context: Option<String>,
  is_end_of_file: Option<bool>,
}

#[derive(Serialize)]
struct ApplyChunksResult {
  new_content: String,
  unified_diff: String,
  additions: u32,
  deletions: u32,
}

/// Apply patch chunks to file content.
///
/// Each chunk has `{ old_lines, new_lines, change_context?, is_end_of_file? }`.
/// Uses seek_sequence to find old_lines in the file, replaces with new_lines.
/// Returns JSON: `{ new_content, unified_diff, additions, deletions }`
#[napi]
pub fn apply_chunks(
  file_path: String,
  file_content: String,
  chunks_json: String,
) -> napi::Result<String> {
  let chunks: Vec<PatchChunk> = serde_json::from_str(&chunks_json)
    .map_err(|e| napi::Error::from_reason(format!("Failed to parse chunks JSON: {}", e)))?;

  let mut original_lines: Vec<String> = file_content.split('\n').map(|s| s.to_string()).collect();

  // Drop trailing empty element for consistent line counting
  if original_lines.last().map(|s| s.as_str()) == Some("") {
    original_lines.pop();
  }

  let mut replacements: Vec<(usize, usize, Vec<String>)> = Vec::new();
  let mut line_index: usize = 0;

  for chunk in &chunks {
    // Handle context-based seeking
    if let Some(ref ctx) = chunk.change_context {
      let lines_ref: Vec<&str> = original_lines.iter().map(|s| s.as_str()).collect();
      let pattern = [ctx.as_str()];
      let ctx_idx = seek_sequence_impl(&lines_ref, &pattern, line_index, false);
      if ctx_idx == -1 {
        return Err(napi::Error::from_reason(format!(
          "Failed to find context '{}' in {}",
          ctx, file_path
        )));
      }
      // BUG-286: Only advance line_index forward to prevent overlap with prior replacements
      let candidate = ctx_idx as usize + 1;
      if candidate > line_index {
        line_index = candidate;
      }
    }

    // Handle pure addition (no old lines)
    if chunk.old_lines.is_empty() {
      let insertion_idx = if !original_lines.is_empty()
        && original_lines.last().map(|s| s.as_str()) == Some("")
      {
        original_lines.len() - 1
      } else {
        original_lines.len()
      };
      replacements.push((insertion_idx, 0, chunk.new_lines.clone()));
      continue;
    }

    let lines_ref: Vec<&str> = original_lines.iter().map(|s| s.as_str()).collect();
    let mut pattern: Vec<&str> = chunk.old_lines.iter().map(|s| s.as_str()).collect();
    let mut new_slice: Vec<String> = chunk.new_lines.clone();
    let eof = chunk.is_end_of_file.unwrap_or(false);

    let mut found = seek_sequence_impl(&lines_ref, &pattern, line_index, eof);

    // Retry without trailing empty line
    if found == -1 && !pattern.is_empty() && *pattern.last().unwrap() == "" {
      pattern.pop();
      if !new_slice.is_empty() && new_slice.last().map(|s| s.as_str()) == Some("") {
        new_slice.pop();
      }
      found = seek_sequence_impl(&lines_ref, &pattern, line_index, eof);
    }

    if found != -1 {
      let f = found as usize;
      replacements.push((f, pattern.len(), new_slice));
      line_index = f + pattern.len();
    } else {
      return Err(napi::Error::from_reason(format!(
        "Failed to find expected lines in {}:\n{}",
        file_path,
        chunk.old_lines.join("\n")
      )));
    }
  }

  // Sort replacements by index
  replacements.sort_by_key(|r| r.0);

  // Apply replacements in reverse order to preserve indices
  let mut result_lines = original_lines;
  for i in (0..replacements.len()).rev() {
    let (start_idx, old_len, ref new_segment) = replacements[i];
    // Remove old lines
    result_lines.splice(start_idx..start_idx + old_len, new_segment.iter().cloned());
  }

  // Ensure trailing newline
  if result_lines.is_empty() || result_lines.last().map(|s| s.as_str()) != Some("") {
    result_lines.push(String::new());
  }

  let new_content = result_lines.join("\n");
  let udiff = generate_unified_diff(&file_path, &file_content, &new_content);
  let (additions, deletions) = compute_diff_stats(&file_content, &new_content);

  let result = ApplyChunksResult {
    new_content,
    unified_diff: udiff,
    additions,
    deletions,
  };

  serde_json::to_string(&result)
    .map_err(|e| napi::Error::from_reason(format!("JSON serialization error: {}", e)))
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;

  // ── edit_replace ────────────────────────────────────────────────────────

  #[test]
  fn edit_replace_simple_replacement() {
    let content = "hello world\nfoo bar\nbaz qux\n".to_string();
    let json = edit_replace(content, "foo bar".into(), "FOO BAR".into(), false).unwrap();
    let result: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(result["new_content"], "hello world\nFOO BAR\nbaz qux\n");
    assert_eq!(result["strategy"], "Simple");
    assert!(result["additions"].as_u64().unwrap() >= 1);
    assert!(result["deletions"].as_u64().unwrap() >= 1);
  }

  #[test]
  fn edit_replace_line_trimmed_matching() {
    let content = "  fn main() {\n    println!(\"hi\");\n  }\n".to_string();
    // Search with different indentation — strategy_simple will miss, but
    // strategy_line_trimmed should match via trimmed comparison.
    let json = edit_replace(
      content,
      "fn main() {\n  println!(\"hi\");\n}".into(),
      "fn entry() {\n  println!(\"hello\");\n}".into(),
      false,
    )
    .unwrap();
    let result: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(result["new_content"].as_str().unwrap().contains("entry"));
    assert_eq!(result["strategy"], "LineTrimmed");
  }

  #[test]
  fn edit_replace_block_anchor_matching() {
    let content = "function foo() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}\n".to_string();
    // Block anchor: first and last lines match; middle may differ slightly.
    let json = edit_replace(
      content,
      "function foo() {\n  const x = 1;\n  const y = 2;\n  return x + y;\n}".into(),
      "function bar() {\n  return 3;\n}".into(),
      false,
    )
    .unwrap();
    let result: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(result["new_content"].as_str().unwrap().contains("bar"));
    assert_eq!(result["strategy"], "BlockAnchor");
  }

  #[test]
  fn edit_replace_replace_all() {
    let content = "aaa bbb aaa ccc aaa".to_string();
    let json = edit_replace(content, "aaa".into(), "ZZZ".into(), true).unwrap();
    let result: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(result["new_content"], "ZZZ bbb ZZZ ccc ZZZ");
    assert_eq!(result["strategy"], "ReplaceAll");
  }

  #[test]
  fn edit_replace_no_match_error() {
    let content = "hello world".to_string();
    let err = edit_replace(content, "nonexistent".into(), "replacement".into(), false);
    assert!(err.is_err());
    let msg = format!("{}", err.unwrap_err());
    assert!(msg.contains("Could not find oldString"));
  }

  #[test]
  fn edit_replace_identical_strings_error() {
    let content = "hello world".to_string();
    let err = edit_replace(content, "hello".into(), "hello".into(), false);
    assert!(err.is_err());
    let msg = format!("{}", err.unwrap_err());
    assert!(msg.contains("identical"));
  }

  // ── seek_sequence_impl ──────────────────────────────────────────────────

  #[test]
  fn seek_sequence_exact_match() {
    let lines = vec!["fn main() {", "  println!(\"hi\");", "}"];
    let pattern = vec!["  println!(\"hi\");"];
    assert_eq!(seek_sequence_impl(&lines, &pattern, 0, false), 1);
  }

  #[test]
  fn seek_sequence_trimmed_match() {
    let lines = vec!["fn main() {", "  println!(\"hi\");  ", "}"];
    // Trailing whitespace differs — exact pass fails, rstrip or trim passes.
    let pattern = vec!["  println!(\"hi\");"];
    assert_eq!(seek_sequence_impl(&lines, &pattern, 0, false), 1);
  }

  #[test]
  fn seek_sequence_unicode_normalization() {
    // Use smart quotes in pattern, straight quotes in source
    let lines = vec!["let s = \"hello\";"];
    let pattern = vec!["let s = \u{201C}hello\u{201D};"];
    // Exact, rstrip, and trim passes will fail; unicode-normalized pass should match.
    assert_eq!(seek_sequence_impl(&lines, &pattern, 0, false), 0);
  }

  #[test]
  fn seek_sequence_eof_flag() {
    let lines = vec!["a", "b", "c", "d", "b"];
    let pattern = vec!["b"];
    // Without eof, should find first occurrence at index 1.
    assert_eq!(seek_sequence_impl(&lines, &pattern, 0, false), 1);
    // With eof, should prefer the match closest to end (index 4).
    assert_eq!(seek_sequence_impl(&lines, &pattern, 0, true), 4);
  }

  #[test]
  fn seek_sequence_not_found_returns_negative_one() {
    let lines = vec!["aaa", "bbb", "ccc"];
    let pattern = vec!["zzz"];
    assert_eq!(seek_sequence_impl(&lines, &pattern, 0, false), -1);
  }

  #[test]
  fn seek_sequence_empty_pattern_returns_negative_one() {
    let lines = vec!["a", "b"];
    let pattern: Vec<&str> = vec![];
    assert_eq!(seek_sequence_impl(&lines, &pattern, 0, false), -1);
  }

  #[test]
  fn seek_sequence_start_index() {
    let lines = vec!["x", "y", "x", "y"];
    let pattern = vec!["x"];
    // Starting from index 1 should skip the first "x".
    assert_eq!(seek_sequence_impl(&lines, &pattern, 1, false), 2);
  }

  // ── unified_diff ────────────────────────────────────────────────────────

  #[test]
  fn unified_diff_basic_output() {
    let old = "line1\nline2\nline3\n";
    let new = "line1\nchanged\nline3\n";
    let diff = generate_unified_diff("test.txt", old, new);
    assert!(diff.contains("--- test.txt"));
    assert!(diff.contains("+++ test.txt"));
    assert!(diff.contains("-line2"));
    assert!(diff.contains("+changed"));
  }

  #[test]
  fn unified_diff_no_changes() {
    let text = "same\ncontent\n";
    let diff = generate_unified_diff("file.rs", text, text);
    // Should have header but no hunks.
    assert!(diff.contains("--- file.rs"));
    assert!(!diff.contains("@@"));
  }

  // ── levenshtein & similarity ──────────────────────────────────────────

  #[test]
  fn levenshtein_basic() {
    assert_eq!(strsim::levenshtein("kitten", "sitting"), 3);
    assert_eq!(strsim::levenshtein("", "abc"), 3);
    assert_eq!(strsim::levenshtein("abc", "abc"), 0);
  }

  #[test]
  fn similarity_basic() {
    let sim = strsim::normalized_levenshtein("abc", "abc");
    assert!((sim - 1.0).abs() < f64::EPSILON);

    let sim2 = strsim::normalized_levenshtein("abc", "xyz");
    assert!(sim2 < 0.5);
  }

  // ── compute_diff_stats ────────────────────────────────────────────────

  #[test]
  fn diff_stats_counts() {
    let old = "a\nb\nc\n";
    let new = "a\nB\nc\nd\n";
    let (additions, deletions) = compute_diff_stats(old, new);
    // "b" removed (1 deletion), "B" and "d" added (2 additions)
    assert_eq!(additions, 2);
    assert_eq!(deletions, 1);
  }

  // ── helper functions ──────────────────────────────────────────────────

  #[test]
  fn normalize_unicode_converts_smart_quotes() {
    assert_eq!(normalize_unicode("\u{201C}hello\u{201D}"), "\"hello\"");
    assert_eq!(normalize_unicode("\u{2018}it\u{2019}s"), "'it's");
    assert_eq!(normalize_unicode("\u{2014}dash"), "-dash");
    assert_eq!(normalize_unicode("\u{2026}"), "...");
    assert_eq!(normalize_unicode("\u{00A0}"), " ");
  }

  #[test]
  fn unescape_string_handles_escapes() {
    assert_eq!(unescape_string(r"hello\nworld"), "hello\nworld");
    assert_eq!(unescape_string(r"tab\there"), "tab\there");
    assert_eq!(unescape_string(r"back\\slash"), "back\\slash");
    assert_eq!(unescape_string(r"quote\'s"), "quote's");
    assert_eq!(unescape_string(r"dollar\$sign"), "dollar$sign");
  }

  #[test]
  fn line_byte_offset_and_extract_lines() {
    let content = "aaa\nbbb\nccc\nddd";
    let lines: Vec<&str> = content.split('\n').collect();
    assert_eq!(line_byte_offset(&lines, 0), 0);
    assert_eq!(line_byte_offset(&lines, 1), 4); // "aaa\n" = 4 bytes
    assert_eq!(line_byte_offset(&lines, 2), 8);

    let extracted = extract_lines(content, &lines, 1, 2);
    assert_eq!(extracted, "bbb\nccc");
  }

  // ── strategy helpers ──────────────────────────────────────────────────

  #[test]
  fn strategy_simple_finds_exact() {
    let content = "hello world";
    assert_eq!(strategy_simple(content, "world"), vec!["world"]);
    assert!(strategy_simple(content, "missing").is_empty());
  }

  #[test]
  fn strategy_multi_occurrence_finds_all() {
    let content = "abcabcabc";
    let results = strategy_multi_occurrence(content, "abc");
    assert_eq!(results.len(), 3);
  }
}
