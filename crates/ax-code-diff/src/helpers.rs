use similar::TextDiff;

// ── Unicode normalization helpers ────────────────────────────────────────────

pub(crate) fn normalize_unicode(s: &str) -> String {
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

pub(crate) fn unescape_string(s: &str) -> String {
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
pub(crate) fn line_byte_offset(lines: &[&str], idx: usize) -> usize {
    let mut offset = 0;
    for (i, line) in lines.iter().enumerate().take(idx) {
        offset += line.len();
        if i + 1 < lines.len() {
            offset += 1; // '\n' separator before the next line
        }
    }
    offset
}

/// Extract the substring from `content` that spans lines[start..=end].
pub(crate) fn extract_lines<'a>(
    content: &'a str,
    lines: &[&str],
    start: usize,
    end: usize,
) -> &'a str {
    let byte_start = line_byte_offset(lines, start);
    let mut byte_end = byte_start;
    for (k, line) in lines.iter().enumerate().take(end + 1).skip(start) {
        byte_end += line.len();
        if k < end {
            byte_end += 1;
        }
    }
    &content[byte_start..byte_end]
}

// ── Strategies ───────────────────────────────────────────────────────────────

/// Each strategy returns a Vec of candidate match strings found in `content`.
/// The caller checks uniqueness (indexOf == lastIndexOf).
pub(crate) fn strategy_simple(content: &str, find: &str) -> Vec<String> {
    if content.contains(find) {
        vec![find.to_string()]
    } else {
        vec![]
    }
}

pub(crate) fn strategy_line_trimmed(content: &str, find: &str) -> Vec<String> {
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

pub(crate) fn strategy_block_anchor(content: &str, find: &str) -> Vec<String> {
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
    for (i, line) in original_lines.iter().enumerate() {
        if line.trim() != first_line_search {
            continue;
        }
        if search_block_size == 1 {
            candidates.push((i, i));
            continue;
        }
        for (j, line) in original_lines.iter().enumerate().skip(i + 1) {
            if line.trim() == last_line_search {
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

pub(crate) fn strategy_whitespace_normalized(content: &str, find: &str) -> Vec<String> {
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

pub(crate) fn strategy_indentation_flexible(content: &str, find: &str) -> Vec<String> {
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

pub(crate) fn strategy_escape_normalized(content: &str, find: &str) -> Vec<String> {
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

pub(crate) fn strategy_trimmed_boundary(content: &str, find: &str) -> Vec<String> {
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

pub(crate) fn strategy_context_aware(content: &str, find: &str) -> Vec<String> {
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

pub(crate) fn strategy_multi_occurrence(content: &str, find: &str) -> Vec<String> {
    if find.is_empty() {
        return Vec::new();
    }
    let mut results = Vec::new();
    let mut start = 0;
    while let Some(idx) = content[start..].find(find) {
        results.push(find.to_string());
        start += idx + find.len();
    }
    results
}

// ── Strategy names ───────────────────────────────────────────────────────────

pub(crate) const STRATEGY_NAMES: &[&str] = &[
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

pub(crate) type StrategyFn = fn(&str, &str) -> Vec<String>;

pub(crate) const STRATEGIES: &[StrategyFn] = &[
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

pub(crate) fn generate_unified_diff(
    file_path: &str,
    old_content: &str,
    new_content: &str,
) -> String {
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

pub(crate) fn compute_diff_stats(old_content: &str, new_content: &str) -> (u32, u32) {
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
