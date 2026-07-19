#[macro_use]
extern crate napi_derive;

use serde::{Deserialize, Serialize};
mod helpers;
use helpers::*;

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
    if old_string.is_empty() {
        return Err(napi::Error::from_reason("oldString must not be empty."));
    }
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
            let new_content = format!(
                "{}{}{}",
                &content[..first],
                new_string,
                &content[first + search.len()..]
            );
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
pub fn seek_sequence(lines: Vec<String>, pattern: Vec<String>, start_index: i32, eof: bool) -> i32 {
    let lines_ref: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let pattern_ref: Vec<&str> = pattern.iter().map(|s| s.as_str()).collect();
    seek_sequence_impl(&lines_ref, &pattern_ref, start_index.max(0) as usize, eof)
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
            let insertion_idx = line_index.min(original_lines.len());
            replacements.push((insertion_idx, 0, chunk.new_lines.clone()));
            continue;
        }

        let lines_ref: Vec<&str> = original_lines.iter().map(|s| s.as_str()).collect();
        let mut pattern: Vec<&str> = chunk.old_lines.iter().map(|s| s.as_str()).collect();
        let mut new_slice: Vec<String> = chunk.new_lines.clone();
        let eof = chunk.is_end_of_file.unwrap_or(false);

        let mut found = seek_sequence_impl(&lines_ref, &pattern, line_index, eof);

        // Retry without trailing empty line
        if found == -1 && pattern.last().is_some_and(|line| line.is_empty()) {
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
        let content =
            "function foo() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}\n".to_string();
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

    #[test]
    fn line_byte_offset_handles_content_without_trailing_newline() {
        let content = "foo\nbar";
        let lines: Vec<&str> = content.split('\n').collect();

        assert_eq!(line_byte_offset(&lines, 2), content.len());
        assert_eq!(extract_lines(content, &lines, 1, 1), "bar");
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

    #[test]
    fn empty_old_string_is_rejected_without_looping() {
        let err = edit_replace("abc".into(), "".into(), "x".into(), false).unwrap_err();
        assert!(err.reason.contains("must not be empty"));
        assert!(strategy_multi_occurrence("abc", "").is_empty());
    }
}
