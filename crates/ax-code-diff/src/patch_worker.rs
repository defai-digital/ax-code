//! Bounded patch content computation. Files, previews and permissions remain with the host.
use crate::helpers::normalize_unicode;
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use serde::Deserialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
const MAX_LINES: usize = 200_000;
const MAX_CHUNKS: usize = 4096;
const MAX_COMPARISONS: usize = 2_000_000;
const MAX_MATCH_BYTES: usize = 128 * 1024 * 1024;

#[napi]
pub struct PatchCancellation {
    cancelled: Arc<AtomicBool>,
}
#[napi]
impl PatchCancellation {
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
        return Err(napi::Error::from_reason("Native patch cancelled"));
    }
    Ok(())
}
fn limit() -> napi::Error {
    napi::Error::from_reason("Patch resource limit exceeded; split the patch into smaller changes")
}
struct Budget<'a> {
    cancel: &'a AtomicBool,
    comparisons: usize,
    bytes: usize,
}
impl Budget<'_> {
    fn compare(&mut self, a: &str, b: &str) -> Result<()> {
        check(self.cancel)?;
        self.comparisons += 1;
        self.bytes += a.len() + b.len();
        if self.comparisons > MAX_COMPARISONS || self.bytes > MAX_MATCH_BYTES {
            return Err(limit());
        }
        Ok(())
    }
}
#[derive(Deserialize)]
struct Chunk {
    old_lines: Vec<String>,
    new_lines: Vec<String>,
    change_context: Option<String>,
    is_end_of_file: Option<bool>,
}
fn js_ws(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn equal(a: &str, b: &str, pass: usize) -> bool {
    // Preserve legacy native-first matching, then the JS fallback's whitespace rules.
    let (a, b) = match pass {
        0 | 4 => return a == b,
        1 => (a.trim_end(), b.trim_end()),
        2 | 3 => (a.trim(), b.trim()),
        5 => (a.trim_end_matches(js_ws), b.trim_end_matches(js_ws)),
        _ => (a.trim_matches(js_ws), b.trim_matches(js_ws)),
    };
    if pass == 3 || pass == 7 {
        normalize_unicode(a) == normalize_unicode(b)
    } else {
        a == b
    }
}
fn seek(
    lines: &[&str],
    pattern: &[String],
    start: usize,
    eof: bool,
    budget: &mut Budget<'_>,
) -> Result<Option<usize>> {
    if pattern.is_empty() || pattern.len() > lines.len() {
        return Ok(None);
    }
    let last = lines.len() - pattern.len();
    for pass in 0..8 {
        let mut matches = |i: usize| -> Result<bool> {
            for (j, expected) in pattern.iter().enumerate() {
                budget.compare(lines[i + j], expected)?;
                if !equal(lines[i + j], expected, pass) {
                    return Ok(false);
                }
            }
            Ok(true)
        };
        if eof && last >= start && matches(last)? {
            return Ok(Some(last));
        }
        for i in start..=last {
            if matches(i)? {
                return Ok(Some(i));
            }
        }
    }
    Ok(None)
}
fn content(file: &str, original: &str, json: &str, cancel: &AtomicBool) -> Result<String> {
    check(cancel)?;
    if file.len() + original.len() + json.len() > MAX_BYTES {
        return Err(limit());
    }
    let chunks: Vec<Chunk> = serde_json::from_str(json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid patch chunks: {e}")))?;
    if chunks.len() > MAX_CHUNKS || original.bytes().filter(|b| *b == b'\n').count() + 1 > MAX_LINES
    {
        return Err(limit());
    }
    let mut chunk_lines = 0;
    for chunk in &chunks {
        check(cancel)?;
        chunk_lines += chunk.old_lines.len() + chunk.new_lines.len();
        if chunk_lines > MAX_LINES {
            return Err(limit());
        }
    }
    let crlf = original.contains("\r\n");
    let normalized = original.replace("\r\n", "\n");
    let mut lines: Vec<&str> = normalized.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    let mut budget = Budget {
        cancel,
        comparisons: 0,
        bytes: 0,
    };
    let mut replacements = Vec::with_capacity(chunks.len());
    let mut cursor = 0;
    for chunk in &chunks {
        check(cancel)?;
        let context = chunk.change_context.as_ref().filter(|s| !s.is_empty());
        if let Some(ctx) = context {
            cursor = seek(
                &lines,
                std::slice::from_ref(ctx),
                cursor,
                false,
                &mut budget,
            )?
            .ok_or_else(|| {
                napi::Error::from_reason(format!("Failed to find context '{ctx}' in {file}"))
            })? + 1;
        }
        if chunk.old_lines.is_empty() {
            let start = if context.is_some() {
                cursor
            } else if lines.last() == Some(&"") {
                lines.len() - 1
            } else {
                lines.len()
            };
            replacements.push((start, 0, chunk.new_lines.as_slice()));
            continue;
        }
        let mut pattern = chunk.old_lines.as_slice();
        let mut new_lines = chunk.new_lines.as_slice();
        let eof = chunk.is_end_of_file.unwrap_or(false);
        let mut found = seek(&lines, pattern, cursor, eof, &mut budget)?;
        if found.is_none() && pattern.last().is_some_and(String::is_empty) {
            pattern = &pattern[..pattern.len() - 1];
            if new_lines.last().is_some_and(String::is_empty) {
                new_lines = &new_lines[..new_lines.len() - 1];
            }
            found = seek(&lines, pattern, cursor, eof, &mut budget)?;
        }
        let start = found.ok_or_else(|| {
            napi::Error::from_reason(format!(
                "Failed to find expected lines in {file}:\n{}",
                chunk.old_lines.join("\n")
            ))
        })?;
        replacements.push((start, pattern.len(), new_lines));
        cursor = start + pattern.len();
    }
    // Stable ordering retains the original order of insertions at the same position.
    replacements.sort_by_key(|r| r.0);
    for pair in replacements.windows(2) {
        if pair[1].0 < pair[0].0 + pair[0].1 {
            return Err(napi::Error::from_reason(format!(
                "Overlapping patch chunks in {file}"
            )));
        }
    }
    let mut result = String::new();
    let ending = if crlf { "\r\n" } else { "\n" };
    let mut append = |line: &str| -> Result<()> {
        check(cancel)?;
        let extra = if crlf {
            line.bytes().filter(|b| *b == b'\n').count()
        } else {
            0
        };
        if result.len() + line.len() + extra + ending.len() > MAX_OUTPUT {
            return Err(limit());
        }
        if crlf {
            result.push_str(&line.replace('\n', "\r\n"));
        } else {
            result.push_str(line);
        }
        result.push_str(ending);
        Ok(())
    };
    cursor = 0;
    for (start, removed, added) in replacements {
        for line in &lines[cursor..start] {
            append(line)?;
        }
        for line in added {
            append(line)?;
        }
        cursor = start + removed;
    }
    for line in &lines[cursor..] {
        append(line)?;
    }
    check(cancel)?;
    Ok(result)
}
pub struct PatchTask {
    file: String,
    original: String,
    chunks: String,
    cancel: Arc<AtomicBool>,
}
impl Task for PatchTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        content(&self.file, &self.original, &self.chunks, &self.cancel)
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancel)?;
        Ok(output)
    }
}
#[napi(ts_return_type = "Promise<string>")]
pub fn apply_patch_content_async(
    file: String,
    original: String,
    chunks: String,
    cancellation: &PatchCancellation,
) -> AsyncTask<PatchTask> {
    AsyncTask::new(PatchTask {
        file,
        original,
        chunks,
        cancel: cancellation.cancelled.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(original: &str, chunks: serde_json::Value) -> Result<String> {
        content(
            "file",
            original,
            &chunks.to_string(),
            &AtomicBool::new(false),
        )
    }
    #[test]
    fn eol_empty_and_same_position_insertions() {
        assert_eq!(run("", serde_json::json!([])).unwrap(), "");
        assert_eq!(
            run("a\r\n\r\n", serde_json::json!([])).unwrap(),
            "a\r\n\r\n"
        );
        assert_eq!(
            run(
                "a\n",
                serde_json::json!([
                    {"old_lines":[],"new_lines":["x"]}, {"old_lines":[],"new_lines":["y"]}
                ])
            )
            .unwrap(),
            "a\nx\ny\n"
        );
    }
    #[test]
    fn native_then_js_whitespace_and_eof() {
        assert_eq!(
            run(
                "a\u{85}\n\u{feff}a\n",
                serde_json::json!([{"old_lines":["a"],"new_lines":["x"]}])
            )
            .unwrap(),
            "x\n\u{feff}a\n"
        );
        assert_eq!(
            run(
                "\u{feff}a\n",
                serde_json::json!([{"old_lines":["a"],"new_lines":["x"]}])
            )
            .unwrap(),
            "x\n"
        );
        assert_eq!(
            run(
                "a\na\n",
                serde_json::json!([{"old_lines":["a"],"new_lines":["x"],"is_end_of_file":true}])
            )
            .unwrap(),
            "a\nx\n"
        );
    }
    #[test]
    fn budgets_and_cancel() {
        let cancelled = AtomicBool::new(true);
        assert!(
            content("file", "", "[]", &cancelled)
                .unwrap_err()
                .reason
                .contains("cancelled")
        );
        assert!(
            run(&"x\n".repeat(MAX_LINES), serde_json::json!([]))
                .unwrap_err()
                .reason
                .contains("resource limit")
        );
        assert!(
            run(&"x".repeat(MAX_OUTPUT), serde_json::json!([]))
                .unwrap_err()
                .reason
                .contains("resource limit")
        );
        let mut old = vec!["a"; 3000];
        old.push("b");
        assert!(
            run(
                &"a\n".repeat(5000),
                serde_json::json!([{"old_lines":old,"new_lines":[]}])
            )
            .unwrap_err()
            .reason
            .contains("resource limit")
        );
    }
}
