//! Strict, byte-preserving application of structured preview hunks.
//! Coordinates are one-based, including empty ranges, as emitted by preview.
use crate::{Error, Result};
use serde::Deserialize;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
const MAX_LINES: usize = 200_000;
const MARKER: &str = "\\ No newline at end of file";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Hunk {
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
    lines: Vec<String>,
}
fn invalid() -> Error {
    Error::new("Invalid or mismatched diff hunks")
}
fn limit() -> Error {
    Error::new("Hunk resource limit exceeded")
}
fn check(cancel: &dyn Fn() -> bool) -> Result<()> {
    if cancel() {
        return Err(Error::new("Hunk application cancelled"));
    }
    Ok(())
}
struct Output {
    text: String,
    lines: usize,
    ended: bool,
}
impl Output {
    fn push(&mut self, line: &str) -> Result<()> {
        if self.ended || line.is_empty() {
            return Err(invalid());
        }
        if self.text.len() + line.len() > MAX_OUTPUT || self.lines >= MAX_LINES {
            return Err(limit());
        }
        self.text.push_str(line);
        self.lines += 1;
        self.ended = !line.ends_with('\n');
        Ok(())
    }
}
pub fn apply(original: &str, json: &str, cancel: &dyn Fn() -> bool) -> Result<String> {
    check(cancel)?;
    if original.len() + json.len() > MAX_BYTES {
        return Err(limit());
    }
    let hunks: Vec<Hunk> = serde_json::from_str(json).map_err(|_| invalid())?;
    if hunks.len() > 4096 {
        return Err(limit());
    }
    let mut source = Vec::new();
    for line in original.split_inclusive('\n') {
        check(cancel)?;
        if source.len() >= MAX_LINES {
            return Err(limit());
        }
        source.push(line);
    }
    let mut output = Output {
        text: String::new(),
        lines: 0,
        ended: false,
    };
    let mut cursor = 0;
    let mut work = 0;
    for hunk in hunks {
        check(cancel)?;
        let start = hunk.old_start.checked_sub(1).ok_or_else(invalid)?;
        if start < cursor || start > source.len() {
            return Err(invalid());
        }
        for line in &source[cursor..start] {
            check(cancel)?;
            output.push(line)?;
        }
        cursor = start;
        if hunk.new_start != output.lines + 1 {
            return Err(invalid());
        }
        let before = output.lines;
        let mut entries = hunk.lines.iter().peekable();
        while let Some(entry) = entries.next() {
            check(cancel)?;
            work += 1;
            if work > 2 * MAX_LINES {
                return Err(limit());
            }
            let prefix = entry.as_bytes().first().copied().ok_or_else(invalid)?;
            if !matches!(prefix, b' ' | b'+' | b'-') || entry.contains('\n') {
                return Err(invalid());
            }
            let mut token = entry[1..].to_owned();
            let no_newline = entries.peek().is_some_and(|line| line.as_str() == MARKER);
            if no_newline {
                entries.next();
            } else {
                token.push('\n');
            }
            if token.is_empty() {
                return Err(invalid());
            }
            if prefix != b'+' {
                if source.get(cursor).copied() != Some(token.as_str()) {
                    return Err(invalid());
                }
                cursor += 1;
                if no_newline && cursor != source.len() {
                    return Err(invalid());
                }
            }
            if prefix != b'-' {
                output.push(&token)?;
            }
        }
        if cursor - start != hunk.old_lines || output.lines - before != hunk.new_lines {
            return Err(invalid());
        }
    }
    for line in &source[cursor..] {
        check(cancel)?;
        output.push(line)?;
    }
    check(cancel)?;
    Ok(output.text)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_roundtrip_bytes() {
        let fixtures = [
            "",
            "a",
            "a\n",
            "a\r\n",
            "\n",
            "\r",
            "中文😀\r\nb",
            "a\nb\nc\n",
            "\0",
        ];
        for before in fixtures {
            for after in fixtures {
                let preview: serde_json::Value = serde_json::from_str(
                    &crate::preview::preview(before, after, false, &|| false).unwrap(),
                )
                .unwrap();
                assert_eq!(
                    apply(before, &preview["hunks"].to_string(), &|| false).unwrap(),
                    after
                );
            }
        }
    }
    #[test]
    fn reject_stale_counts_coordinates_markers_and_limits() {
        let good = r#"[{"oldStart":1,"newStart":1,"oldLines":1,"newLines":1,"lines":["-a","+b"]}]"#;
        assert_eq!(apply("a\n", good, &|| false).unwrap(), "b\n");
        for bad in [
            good.replace("oldStart\":1", "oldStart\":0"),
            good.replace("newStart\":1", "newStart\":2"),
            good.replace("oldLines\":1", "oldLines\":2"),
            good.replace("-a", "-z"),
            good.replace("+b", "?b"),
            good.replace("+b", "+b\\n"),
        ] {
            assert!(apply("a\n", &bad, &|| false).is_err());
        }
        assert!(apply("a\n", good, &|| true).is_err());
        assert!(apply(&"\n".repeat(MAX_LINES + 1), "[]", &|| false).is_err());
    }
}
