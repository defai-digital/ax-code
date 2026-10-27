//! Slim canonical edit matching. Policy, approval, snapshots and writes stay in JS.
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use std::{
    collections::BTreeSet,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[napi]
pub struct EditCancellation {
    cancelled: Arc<AtomicBool>,
}
#[napi]
impl EditCancellation {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
    #[napi]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}
fn check(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(napi::Error::from_reason("Native edit cancelled"))
    } else {
        Ok(())
    }
}
fn ws(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn trim(s: &str) -> &str {
    s.trim_matches(ws)
}
fn normalize(s: &str) -> String {
    let mut result = String::new();
    let mut space = true;
    for c in s.chars() {
        if ws(c) {
            if !space {
                result.push(' ');
            }
            space = true;
        } else {
            result.push(c);
            space = false;
        }
    }
    if result.ends_with(' ') {
        result.pop();
    }
    result
}
fn distance(a: &str, b: &str, cancel: &AtomicBool) -> Result<usize> {
    // Identical strings are distance 0 even above the length cap below.
    if a == b {
        return Ok(0);
    }
    // JS counts UTF-16 code units, including astral characters, in both distance and denominator.
    let a: Vec<u16> = a.encode_utf16().collect();
    let b: Vec<u16> = b.encode_utf16().collect();
    if a.len() > 2_000 || b.len() > 2_000 {
        return Ok(a.len().max(b.len()));
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut next = vec![0; b.len() + 1];
    for (i, ac) in a.iter().enumerate() {
        check(cancel)?;
        next[0] = i + 1;
        for (j, bc) in b.iter().enumerate() {
            next[j + 1] = (prev[j + 1] + 1)
                .min(next[j] + 1)
                .min(prev[j] + usize::from(ac != bc));
        }
        std::mem::swap(&mut prev, &mut next);
    }
    Ok(prev[b.len()])
}
fn score(a: &[&str], b: &[&str], cancel: &AtomicBool) -> Result<f64> {
    let mut sum = 0.0;
    let mut count = 0;
    for (a, b) in a.iter().zip(b) {
        let a = trim(a);
        let b = trim(b);
        let max = a.encode_utf16().count().max(b.encode_utf16().count());
        if max == 0 {
            continue;
        }
        count += 1;
        sum += 1.0 - distance(a, b, cancel)? as f64 / max as f64;
    }
    Ok(if count == 0 { 1.0 } else { sum / count as f64 })
}
fn occurrences(content: &str, find: &str, matches: &mut BTreeSet<(usize, usize)>) {
    if find.is_empty() {
        return;
    }
    for (i, _) in content.match_indices(find) {
        matches.insert((i, i + find.len()));
    }
}
fn deindent(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let amount = lines
        .iter()
        .filter(|l| !trim(l).is_empty())
        .map(|l| {
            l.chars()
                .take_while(|c| ws(*c))
                .map(char::len_utf16)
                .sum::<usize>()
        })
        .min();
    let Some(amount) = amount else {
        return text.into();
    };
    lines
        .iter()
        .map(|l| {
            if trim(l).is_empty() {
                return l.to_string();
            }
            // Whitespace consists of BMP code points, so the minimum indent always ends on a character boundary.
            let offset = l
                .char_indices()
                .nth(amount)
                .map(|(i, _)| i)
                .unwrap_or(l.len());
            l[offset..].to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn splice_crlf(original: &str, result: &str) -> Result<String> {
    let units: Vec<u16> = original.encode_utf16().collect();
    let output: Vec<u16> = result.encode_utf16().collect();
    let mut normalized = Vec::new();
    let mut offsets = vec![0];
    let mut i = 0;
    while i < units.len() {
        if units[i] == 13 && units.get(i + 1) == Some(&10) {
            normalized.push(10);
            i += 2;
        } else {
            normalized.push(units[i]);
            i += 1;
        }
        offsets.push(i);
    }
    let mut start = 0;
    while start < normalized.len() && start < output.len() && normalized[start] == output[start] {
        start += 1;
    }
    let mut end = normalized.len();
    let mut result_end = output.len();
    while end > start && result_end > start && normalized[end - 1] == output[result_end - 1] {
        end -= 1;
        result_end -= 1;
    }
    let mut combined = units[..offsets[start]].to_vec();
    for &c in &output[start..result_end] {
        if c == 10 {
            combined.push(13);
        }
        combined.push(c);
    }
    combined.extend_from_slice(&units[offsets[end]..]);
    String::from_utf16(&combined)
        .map_err(|_| napi::Error::from_reason("Native edit cannot represent output UTF-16"))
}

fn replace_all_literal(content: &str, old: &str, new: &str, cancel: &AtomicBool) -> Result<String> {
    if !content.contains(old) {
        return Err(napi::Error::from_reason(
            "Could not find oldString in the file. It must match exactly when replaceAll is enabled.",
        ));
    }
    let mut count = 0usize;
    for _ in content.match_indices(old) {
        check(cancel)?;
        count += 1;
    }
    let output_size = count
        .checked_mul(new.len())
        .and_then(|size| size.checked_add(content.len() - count * old.len()));
    let Some(output_size) = output_size.filter(|&size| size <= 64 * 1024 * 1024) else {
        return Err(napi::Error::from_reason(
            "Native edit output limit exceeded",
        ));
    };
    let mut result = String::with_capacity(output_size);
    let mut from = 0;
    for (i, _) in content.match_indices(old) {
        check(cancel)?;
        result.push_str(&content[from..i]);
        result.push_str(new);
        from = i + old.len();
    }
    result.push_str(&content[from..]);
    return Ok(result);
}

pub(crate) fn replace(
    content: &str,
    old: &str,
    new: &str,
    all: bool,
    cancel: &AtomicBool,
) -> Result<String> {
    check(cancel)?;
    if old == new {
        return Err(napi::Error::from_reason(
            "No changes to apply: oldString and newString are identical.",
        ));
    }
    if old.is_empty() {
        return Err(napi::Error::from_reason("oldString must not be empty."));
    }
    if content.len() > 32 * 1024 * 1024 || old.len() > 2_000_000 || new.len() > 4_000_000 {
        return Err(napi::Error::from_reason("Native edit input limit exceeded"));
    }
    if all {
        // Mixed endings: the caller converted old to the dominant CRLF form, so
        // a literal pass would skip the bare-LF copies. Replace on the
        // normalized text and splice the changes back onto the original endings.
        let crlf_count = content.matches("\r\n").count();
        if crlf_count > 0 && content.matches('\n').count() > crlf_count {
            let normalized = replace_all_literal(
                &content.replace("\r\n", "\n"),
                &old.replace("\r\n", "\n"),
                &new.replace("\r\n", "\n"),
                cancel,
            )?;
            return splice_crlf(content, &normalized);
        }
        return replace_all_literal(content, old, new, cancel);
    }
    let crlf = content.contains("\r\n");
    let normalized_content;
    let normalized_old;
    let normalized_new;
    let (text, find, next) = if crlf {
        normalized_content = content.replace("\r\n", "\n");
        normalized_old = old.replace("\r\n", "\n");
        normalized_new = new.replace("\r\n", "\n");
        (
            normalized_content.as_str(),
            normalized_old.as_str(),
            normalized_new.as_str(),
        )
    } else {
        (content, old, new)
    };
    let lines: Vec<&str> = text.split('\n').collect();
    let search: Vec<&str> = find.split('\n').collect();
    let mut starts = Vec::with_capacity(lines.len());
    let mut offset = 0;
    for line in &lines {
        starts.push(offset);
        offset += line.len() + 1;
    }
    let range = |i: usize, j: usize| (starts[i], starts[j] + lines[j].len());
    let mut found = false;
    for strategy in 0..9 {
        check(cancel)?;
        let mut matches = BTreeSet::new();
        match strategy {
            0 | 8 => occurrences(text, find, &mut matches),
            1 => {
                let n = search.len() - usize::from(search.last() == Some(&""));
                if n > 0 && n <= lines.len() {
                    for i in 0..=lines.len() - n {
                        check(cancel)?;
                        if (0..n).all(|j| trim(lines[i + j]) == trim(search[j])) {
                            matches.insert(range(i, i + n - 1));
                        }
                    }
                }
            }
            2 => {
                if search.len() < 3 {
                    continue;
                }
                let n = search.len() - usize::from(search.last() == Some(&""));
                let mut candidates = Vec::new();
                for i in 0..lines.len() {
                    check(cancel)?;
                    if trim(lines[i]) != trim(search[0]) {
                        continue;
                    }
                    for j in i + 1..lines.len() {
                        check(cancel)?;
                        if trim(lines[j]) == trim(search[n - 1]) {
                            // The block must span exactly the searched line
                            // count; pairing anchors across any distance
                            // replaced unnamed lines between them.
                            if j - i + 1 == n {
                                candidates.push((i, j));
                            }
                            break;
                        }
                    }
                }
                let mut best = -1.0;
                let mut selected = Vec::new();
                for (i, j) in candidates {
                    let middle = (n - 2).min(j - i - 1);
                    let similarity = score(
                        &lines[i + 1..i + 1 + middle],
                        &search[1..1 + middle],
                        cancel,
                    )?;
                    if similarity > best {
                        best = similarity;
                        selected.clear();
                        selected.push((i, j));
                    } else if similarity == best {
                        selected.push((i, j));
                    }
                }
                if best >= 0.95 {
                    for (i, j) in selected {
                        matches.insert(range(i, j));
                    }
                }
            }
            3 => {
                let normalized_find = normalize(find);
                let words: Vec<&str> = trim(find).split(ws).filter(|w| !w.is_empty()).collect();
                let regex = if !words.is_empty() && words.len() <= 6 {
                    let whitespace = "[\\x09-\\x0d \\u{00a0}\\u{1680}\\u{2000}-\\u{200a}\\u{2028}\\u{2029}\\u{202f}\\u{205f}\\u{3000}\\u{feff}]+";
                    regex::Regex::new(
                        &words
                            .iter()
                            .map(|w| regex::escape(w))
                            .collect::<Vec<_>>()
                            .join(whitespace),
                    )
                    .ok()
                } else {
                    None
                };
                for (i, line) in lines.iter().enumerate() {
                    check(cancel)?;
                    let normalized_line = normalize(line);
                    if normalized_line == normalized_find {
                        matches.insert(range(i, i));
                    } else if normalized_line.contains(&normalized_find) {
                        if words.len() > 6 {
                            let mut normalized = String::new();
                            let mut mapping = Vec::new();
                            let mut space = true;
                            for (pos, c) in line.char_indices() {
                                if ws(c) {
                                    if !space {
                                        normalized.push(' ');
                                        mapping.push((pos, pos + c.len_utf8()));
                                    }
                                    space = true;
                                } else {
                                    normalized.push(c);
                                    for _ in 0..c.len_utf8() {
                                        mapping.push((pos, pos + c.len_utf8()));
                                    }
                                    space = false;
                                }
                            }
                            if normalized.ends_with(' ') {
                                normalized.pop();
                                mapping.pop();
                            }
                            for (start, _) in normalized.match_indices(&normalized_find) {
                                if !normalized_find.is_empty() {
                                    let end = start + normalized_find.len() - 1;
                                    matches.insert((
                                        starts[i] + mapping[start].0,
                                        starts[i] + mapping[end].1,
                                    ));
                                }
                            }
                        } else if let Some(re) = &regex {
                            for m in re.find_iter(line) {
                                matches.insert((starts[i] + m.start(), starts[i] + m.end()));
                            }
                        }
                    }
                }
                if search.len() > 1 && search.len() <= lines.len() {
                    for i in 0..=lines.len() - search.len() {
                        check(cancel)?;
                        let r = range(i, i + search.len() - 1);
                        if normalize(&text[r.0..r.1]) == normalized_find {
                            matches.insert(r);
                        }
                    }
                }
            }
            4 => {
                let normalized_find = deindent(find);
                if search.len() <= lines.len() {
                    for i in 0..=lines.len() - search.len() {
                        check(cancel)?;
                        let r = range(i, i + search.len() - 1);
                        if deindent(&text[r.0..r.1]) == normalized_find {
                            matches.insert(r);
                        }
                    }
                }
            }
            5 => {
                let unescaped = crate::helpers::unescape_string(find);
                if text.contains(&unescaped) {
                    occurrences(text, &unescaped, &mut matches);
                } else {
                    let n = unescaped.split('\n').count();
                    if n <= lines.len() {
                        for i in 0..=lines.len() - n {
                            check(cancel)?;
                            let r = range(i, i + n - 1);
                            if crate::helpers::unescape_string(&text[r.0..r.1]) == unescaped {
                                matches.insert(r);
                            }
                        }
                    }
                }
            }
            6 => {
                let trimmed = trim(find);
                if trimmed == find || trimmed.is_empty() {
                    continue;
                }
                occurrences(text, trimmed, &mut matches);
                if search.len() <= lines.len() {
                    for i in 0..=lines.len() - search.len() {
                        check(cancel)?;
                        let r = range(i, i + search.len() - 1);
                        if trim(&text[r.0..r.1]) == trimmed {
                            matches.insert(r);
                        }
                    }
                }
            }
            7 => {
                if search.len() < 3 {
                    continue;
                }
                let n = search.len() - usize::from(search.last() == Some(&""));
                if n < 2 {
                    continue;
                }
                for i in 0..lines.len() {
                    check(cancel)?;
                    if trim(lines[i]) != trim(search[0]) {
                        continue;
                    }
                    for j in i + 1..lines.len() {
                        check(cancel)?;
                        if trim(lines[j]) != trim(search[n - 1]) || j - i + 1 != n {
                            continue;
                        }
                        let similarity = score(&lines[i + 1..j], &search[1..n - 1], cancel)?;
                        if similarity >= 0.95 {
                            matches.insert(range(i, j));
                            break;
                        }
                    }
                }
            }
            _ => unreachable!(),
        }
        // Empty candidates are valid only when they came from an indexed line match.
        if matches.is_empty() {
            continue;
        }
        found = true;
        // Ambiguity is sticky: a fuzzier strategy must not pick one of several
        // matches the caller never disambiguated.
        if matches.len() != 1 {
            break;
        }
        let &(start, end) = matches.iter().next().unwrap();
        let mut result = String::with_capacity(text.len() + next.len());
        result.push_str(&text[..start]);
        result.push_str(next);
        result.push_str(&text[end..]);
        check(cancel)?;
        return if crlf {
            splice_crlf(content, &result)
        } else {
            Ok(result)
        };
    }
    Err(napi::Error::from_reason(if found {
        "Found multiple matches for oldString. Provide more surrounding context to make the match unique."
    } else {
        "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings."
    }))
}

pub struct EditTask {
    content: String,
    old: String,
    new: String,
    all: bool,
    cancelled: Arc<AtomicBool>,
}
impl Task for EditTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        replace(
            &self.content,
            &self.old,
            &self.new,
            self.all,
            &self.cancelled,
        )
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancelled)?;
        Ok(output)
    }
}
#[napi(ts_return_type = "Promise<string>")]
pub fn edit_replace_async(
    content: String,
    old_string: String,
    new_string: String,
    replace_all: bool,
    cancellation: &EditCancellation,
) -> AsyncTask<EditTask> {
    AsyncTask::new(EditTask {
        content,
        old: old_string,
        new: new_string,
        all: replace_all,
        cancelled: cancellation.cancelled.clone(),
    })
}
#[napi]
pub fn edit_replace_slim(
    content: String,
    old_string: String,
    new_string: String,
    replace_all: bool,
) -> Result<String> {
    replace(
        &content,
        &old_string,
        &new_string,
        replace_all,
        &AtomicBool::new(false),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identical_long_lines_have_zero_distance() {
        let line = "x".repeat(2_001);
        let cancel = AtomicBool::new(false);
        assert_eq!(distance(&line, &line, &cancel).unwrap(), 0);
        assert_eq!(distance(&line, "y", &cancel).unwrap(), 2_001);
    }
    #[test]
    fn canonical_bounds_and_cancellation() {
        let cancelled = AtomicBool::new(true);
        assert!(replace("a", "a", "b", false, &cancelled).is_err());
        let cancelled = AtomicBool::new(false);
        assert!(
            replace(
                &"a".repeat(100),
                "a",
                &"b".repeat(1_000_000),
                true,
                &cancelled
            )
            .unwrap_err()
            .reason
            .contains("output limit")
        );
        assert_eq!(
            replace(
                "hello\r\n  target\nend\r\n",
                "target",
                "new",
                false,
                &cancelled
            )
            .unwrap(),
            "hello\r\n  new\nend\r\n"
        );
        assert!(replace("a\na", "a", "b", false, &cancelled).is_err());
        assert_eq!(
            replace("😀 a", "a", "$&", true, &cancelled).unwrap(),
            "😀 $&"
        );
    }
}
