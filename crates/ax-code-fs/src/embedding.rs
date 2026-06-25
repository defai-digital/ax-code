use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// 6. Embedding prep — chunking, normalization, hashing for embedding pipeline
// ---------------------------------------------------------------------------

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileChunk {
    pub(crate) path: String,
    pub(crate) chunk_index: u32,
    pub(crate) start_line: u32,
    pub(crate) end_line: u32,
    pub(crate) content: String,
    pub(crate) token_estimate: u32,
    pub(crate) hash: String,
}

/// Split a file into chunks suitable for embedding.
/// Chunks at paragraph/function boundaries when possible, otherwise at line count.
#[napi]
pub fn chunk_file(
    path: String,
    content: String,
    max_lines: u32,
    overlap_lines: u32,
) -> napi::Result<String> {
    let lines: Vec<&str> = content.lines().collect();
    let max = max_lines as usize;
    // BUG-302: Clamp overlap to strictly less than max to guarantee forward progress
    let overlap = if max == 0 {
        0
    } else {
        overlap_lines as usize % max
    };
    let mut chunks = Vec::new();
    let mut start = 0usize;
    let mut chunk_idx = 0u32;

    // Guard: max_lines == 0 would loop forever
    if max == 0 {
        return serde_json::to_string(&chunks).map_err(|e| napi::Error::from_reason(e.to_string()));
    }

    while start < lines.len() {
        let end = (start + max).min(lines.len());
        let chunk_content: String = lines[start..end].join("\n");

        // Token estimate: ~4 chars per token (rough heuristic)
        let token_est = (chunk_content.len() / 4) as u32;

        // Content hash for dedup
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        chunk_content.hash(&mut hasher);
        let hash = format!("{:016x}", hasher.finish());

        chunks.push(FileChunk {
            path: path.clone(),
            chunk_index: chunk_idx,
            start_line: start as u32,
            end_line: end as u32,
            content: chunk_content,
            token_estimate: token_est,
            hash,
        });

        chunk_idx += 1;
        start = if end >= lines.len() {
            lines.len()
        } else {
            end - overlap
        };
    }

    serde_json::to_string(&chunks).map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Normalize text for embedding: collapse whitespace, strip comments, normalize unicode.
#[napi]
pub fn normalize_for_embedding(content: String) -> String {
    let mut result = String::with_capacity(content.len());
    let mut prev_was_space = false;

    for ch in content.chars() {
        match ch {
            '\t' | '\r' => {
                if !prev_was_space {
                    result.push(' ');
                    prev_was_space = true;
                }
            }
            '\n' => {
                result.push('\n');
                prev_was_space = false;
            }
            ' ' => {
                if !prev_was_space {
                    result.push(' ');
                    prev_was_space = true;
                }
            }
            // Normalize unicode quotes/dashes
            '\u{2018}' | '\u{2019}' | '\u{201A}' => {
                result.push('\'');
                prev_was_space = false;
            }
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => {
                result.push('"');
                prev_was_space = false;
            }
            '\u{2010}'..='\u{2015}' => {
                result.push('-');
                prev_was_space = false;
            }
            '\u{2026}' => {
                result.push_str("...");
                prev_was_space = false;
            }
            '\u{00A0}' => {
                if !prev_was_space {
                    result.push(' ');
                    prev_was_space = true;
                }
            }
            _ => {
                result.push(ch);
                prev_was_space = false;
            }
        }
    }
    result
}

/// Estimate token count for a string (rough: ~4 chars per token).
#[napi]
pub fn estimate_tokens(content: String) -> u32 {
    (content.len() / 4) as u32
}

/// Compute content hash for dedup.
#[napi]
pub fn content_hash(content: String) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_file_basic() {
        let content = "line1\nline2\nline3\nline4\nline5";
        let json = chunk_file("test.txt".into(), content.into(), 2, 0).unwrap();
        let chunks: Vec<FileChunk> = serde_json::from_str(&json).unwrap();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].start_line, 0);
        assert_eq!(chunks[0].end_line, 2);
        assert_eq!(chunks[1].start_line, 2);
        assert_eq!(chunks[1].end_line, 4);
    }

    #[test]
    fn chunk_file_zero_max_returns_empty() {
        let json = chunk_file("test.txt".into(), "content".into(), 0, 0).unwrap();
        let chunks: Vec<FileChunk> = serde_json::from_str(&json).unwrap();
        assert!(chunks.is_empty());
    }

    #[test]
    fn chunk_file_overlap() {
        let content = "line1\nline2\nline3\nline4";
        let json = chunk_file("test.txt".into(), content.into(), 2, 1).unwrap();
        let chunks: Vec<FileChunk> = serde_json::from_str(&json).unwrap();
        assert!(chunks.len() >= 2);
        // Second chunk should start before the first ends (overlap)
        assert!(chunks[1].start_line < chunks[0].end_line);
    }

    #[test]
    fn normalize_collapses_whitespace() {
        let result = normalize_for_embedding("hello  world\t\ttest".into());
        assert_eq!(result, "hello world test");
    }

    #[test]
    fn normalize_unicode_quotes() {
        let result = normalize_for_embedding("\u{201C}hello\u{201D}".into());
        assert_eq!(result, "\"hello\"");
    }

    #[test]
    fn normalize_unicode_dashes() {
        let result = normalize_for_embedding("a\u{2014}b".into());
        assert_eq!(result, "a-b");
    }

    #[test]
    fn normalize_ellipsis() {
        let result = normalize_for_embedding("wait\u{2026}".into());
        assert_eq!(result, "wait...");
    }

    #[test]
    fn estimate_tokens_basic() {
        // ~4 chars per token
        assert_eq!(estimate_tokens("1234".into()), 1);
        assert_eq!(estimate_tokens("12345678".into()), 2);
        assert_eq!(estimate_tokens("".into()), 0);
    }

    #[test]
    fn content_hash_deterministic() {
        let h1 = content_hash("hello world".into());
        let h2 = content_hash("hello world".into());
        assert_eq!(h1, h2);
    }

    #[test]
    fn content_hash_differs_for_different_input() {
        let h1 = content_hash("hello".into());
        let h2 = content_hash("world".into());
        assert_ne!(h1, h2);
    }
}
