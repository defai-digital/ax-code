//! Greedy Jaccard grouping. Normalization and report policy remain with the host.
use crate::{Error, Result};
use serde::Serialize;
use std::collections::HashMap;

const MAX_ROWS: usize = 10_000;
const MAX_ENTRIES: usize = 200_000;
const MAX_INPUT: usize = 16 * 1024 * 1024;
const MAX_WORK: usize = 200_000_000;
fn check(cancel: &impl Fn() -> bool) -> Result<()> {
    if cancel() {
        return Err(Error::new("Native duplicate comparison cancelled"));
    }
    Ok(())
}
fn limit() -> Error {
    Error::new("Duplicate comparison resource limit exceeded; reduce maxCandidates")
}
#[derive(Serialize)]
struct Group {
    indices: Vec<usize>,
    score: f64,
}
#[derive(Serialize)]
struct Groups {
    version: u32,
    groups: Vec<Group>,
}
pub fn groups(input: &str, threshold: f64, cancel: &impl Fn() -> bool) -> Result<String> {
    check(cancel)?;
    if input.len() > MAX_INPUT || !threshold.is_finite() {
        return Err(limit());
    }
    let tokens: Vec<Vec<String>> = serde_json::from_str(input)
        .map_err(|e| Error::new(format!("Invalid duplicate tokens: {e}")))?;
    if tokens.len() > MAX_ROWS || tokens.iter().map(Vec::len).sum::<usize>() > MAX_ENTRIES {
        return Err(limit());
    }
    let mut dictionary = HashMap::new();
    let mut rows = Vec::with_capacity(tokens.len());
    for set in tokens {
        check(cancel)?;
        let mut row = Vec::with_capacity(set.len());
        for token in set {
            check(cancel)?;
            let next = dictionary.len() as u32;
            row.push(*dictionary.entry(token).or_insert(next));
        }
        row.sort_unstable();
        row.dedup();
        rows.push(row);
    }
    let mut paired = vec![false; rows.len()];
    let mut output = Vec::new();
    let mut work = 0;
    let mut pairs = 0;
    for i in 0..rows.len() {
        check(cancel)?;
        if paired[i] {
            continue;
        }
        let mut indices = vec![i];
        let mut minimum = 1.0;
        for j in i + 1..rows.len() {
            if paired[j] {
                continue;
            }
            check(cancel)?;
            pairs += 1;
            if pairs > 50_000_000 {
                return Err(limit());
            }
            let (a, b) = (&rows[i], &rows[j]);
            let (mut left, mut right, mut intersection) = (0, 0, 0);
            while left < a.len() && right < b.len() {
                work += 1;
                if work > MAX_WORK {
                    return Err(limit());
                }
                if work % 1024 == 0 {
                    check(cancel)?;
                }
                match a[left].cmp(&b[right]) {
                    std::cmp::Ordering::Less => left += 1,
                    std::cmp::Ordering::Greater => right += 1,
                    std::cmp::Ordering::Equal => {
                        intersection += 1;
                        left += 1;
                        right += 1;
                    }
                }
            }
            let union = a.len() + b.len() - intersection;
            // Use the same IEEE-754 division and >= comparison as JS.
            // Cross-multiplication changes boundary rounding and is not equivalent.
            let score = if union == 0 {
                1.0
            } else {
                intersection as f64 / union as f64
            };
            if score >= threshold {
                indices.push(j);
                paired[j] = true;
                if score < minimum {
                    minimum = score;
                }
            }
        }
        if indices.len() > 1 {
            paired[i] = true;
            output.push(Group {
                indices,
                score: minimum,
            });
        }
    }
    check(cancel)?;
    let json = serde_json::to_string(&Groups {
        version: 1,
        groups: output,
    })
    .map_err(|e| Error::new(e.to_string()))?;
    if json.len() > 1024 * 1024 {
        return Err(limit());
    }
    check(cancel)?;
    Ok(json)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greedy_not_transitive_and_empty_sets() {
        let result = groups(r#"[["a","b"],["a","b","c"],["b","c"]]"#, 0.6, &|| false).unwrap();
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["groups"][0]["indices"], serde_json::json!([0, 1]));
        assert_eq!(v["groups"].as_array().unwrap().len(), 1);
        let result = groups("[[],[]]", 1.0, &|| false).unwrap();
        assert!(result.contains(r#""score":1.0"#));
    }
    #[test]
    fn reject_cancel_and_limits() {
        assert!(
            groups("[]", 0.5, &|| true)
                .unwrap_err()
                .reason
                .contains("cancelled")
        );
        assert!(groups("[]", f64::NAN, &|| false).is_err());
        assert!(
            groups(
                &serde_json::to_string(&vec![Vec::<String>::new(); 10001]).unwrap(),
                0.5,
                &|| false
            )
            .is_err()
        );
    }
}
