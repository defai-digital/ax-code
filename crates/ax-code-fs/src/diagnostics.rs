//! Selected-file projections matching the TypeScript per-file heuristics.
//! Scope admission and report composition remain with the caller.
use crate::scan::{CancellableReader, ScanCancellation, check};
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    sync::{Arc, LazyLock, atomic::AtomicBool},
};

// JavaScript's non-Unicode word/digit classes are ASCII. Its whitespace set
// includes BOM and excludes NEL, unlike Rust's Unicode \s.
fn js_regex(pattern: &str) -> Regex {
    let pattern = pattern.replace(r"\w", "[[:word:]]").replace(r"\d", "[0-9]")
        .replace(r"\s", r"[\x09-\x0D\x20\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]");
    Regex::new(&pattern).expect("constant diagnostic pattern must compile")
}
macro_rules! re {
    ($pattern:literal) => {{
        static RE: LazyLock<Regex> = LazyLock::new(|| js_regex($pattern));
        &*RE
    }};
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    kind: String,
    files: Vec<String>,
    patterns: Vec<String>,
    max_per_file: usize,
}

fn enabled(patterns: &[String], kind: &str) -> bool {
    patterns.iter().any(|p| p == kind)
}
fn units(value: &str) -> usize {
    value.encode_utf16().count()
}
fn whitespace(ch: char) -> bool {
    matches!(ch, '\u{0009}'..='\u{000D}' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}
fn trim(value: &str) -> &str {
    value.trim_matches(whitespace)
}
fn suppressed(lines: &[&str], i: usize, regex: &Regex) -> bool {
    regex.is_match(lines[i]) || (i > 0 && regex.is_match(lines[i - 1]))
}
fn window(lines: &[&str], i: usize, before: usize, after: usize) -> String {
    lines[i.saturating_sub(before)..(i + after + 1).min(lines.len())].join("\n")
}

fn skip_space(source: &str, mut index: usize) -> usize {
    while let Some(ch) = source[index..].chars().next() {
        if !whitespace(ch) {
            break;
        }
        index += ch.len_utf8();
    }
    index
}
fn literal(source: &str, start: usize) -> Option<(usize, bool)> {
    let bytes = source.as_bytes();
    let quote = *bytes.get(start)?;
    if !matches!(quote, b'\'' | b'"' | b'`') {
        return None;
    }
    let mut interpolation = false;
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if quote == b'`' && bytes[i] == b'$' && bytes.get(i + 1) == Some(&b'{') {
            interpolation = true;
        }
        if bytes[i] == quote {
            return Some((i + 1, interpolation));
        }
        i += 1;
    }
    None
}
fn literal_segments(source: &str, mut index: usize) -> bool {
    let mut saw = false;
    while index < source.len() {
        index = skip_space(source, index);
        if source.as_bytes().get(index) == Some(&b')') {
            return saw;
        }
        let Some((next, interpolation)) = literal(source, index) else {
            return false;
        };
        if interpolation {
            return false;
        }
        saw = true;
        index = skip_space(source, next);
        match source.as_bytes().get(index) {
            Some(b',') => index += 1,
            Some(b')') => return true,
            _ => return false,
        }
    }
    false
}
fn safe_path_call(source: &str) -> bool {
    let Some(open) = source.find('(') else {
        return false;
    };
    if literal_segments(source, open + 1) {
        return true;
    }
    let index = skip_space(source, open + 1);
    let rest = &source[index..];
    let root = if rest.starts_with("os.tmpdir()") {
        11
    } else if rest.starts_with("tmpdir()") {
        8
    } else {
        return false;
    };
    let index = skip_space(source, index + root);
    source.as_bytes().get(index) == Some(&b',') && literal_segments(source, index + 1)
}

fn security(source: &str, file: &str, input: &Input, cancelled: &AtomicBool) -> Result<Vec<Value>> {
    let lines: Vec<_> = source.split('\n').collect();
    let mut findings = Vec::new();
    let suppress = re!(r"//\s*@scan-suppress\s+security_scan");
    let normalized = file.replace('\\', "/");
    let trusted = normalized.contains("/script/")
        || re!(r"(^|/)drizzle\.config\.[cm]?[jt]s$").is_match(&normalized);
    for kind in [
        "path_traversal",
        "command_injection",
        "env_leak",
        "missing_validation",
        "ssrf",
    ] {
        if !enabled(&input.patterns, kind) || (kind == "path_traversal" && trusted) {
            continue;
        }
        for (i, line) in lines.iter().enumerate() {
            check(cancelled)?;
            if findings.len() >= input.max_per_file {
                break;
            }
            if suppressed(&lines, i, suppress) {
                continue;
            }
            let ln = i + 1;
            let (severity, description) = match kind {
                "path_traversal" => {
                    if !re!(r"path\.(?:join|resolve)\s*\((.+)").is_match(line) {
                        continue;
                    }
                    if re!(r"(?:contains|containsPath|isSubpath|startsWith|Filesystem\.contains|within|inside|assertContained)\s*\(").is_match(&window(&lines, i, 5, 5)) { continue; }
                    let mut args = line[line.find("path.").unwrap_or(0)..].to_owned();
                    let mut j = i + 1;
                    while !args.contains(')') && j < lines.len() && j < i + 20 {
                        args.push(' ');
                        args.push_str(lines[j]);
                        j += 1;
                    }
                    if safe_path_call(&args) {
                        continue;
                    }
                    (
                        "high",
                        format!(
                            "path.join/resolve with variable input at line {ln} without containment check. May allow path traversal to access files outside the intended directory."
                        ),
                    )
                }
                "command_injection" => {
                    let exec = re!(
                        r"(?:exec|execSync|execFile|execFileSync)\s*\(\s*(?:`[^`]*\$\{|[^,)]+\+)"
                    )
                    .is_match(line);
                    if !exec
                        && !re!(r"(?:spawn|spawnSync)\s*\(\s*(?:`[^`]*\$\{|[^,)]+\+)")
                            .is_match(line)
                    {
                        continue;
                    }
                    (
                        "high",
                        format!(
                            "{} with string interpolation/concatenation at line {ln}. Variable input may allow command injection.",
                            if exec { "exec" } else { "spawn" }
                        ),
                    )
                }
                "env_leak" => {
                    if !re!(r"env\s*:\s*\{?\s*\.\.\.process\.env").is_match(line)
                        || re!(r"(?:Env\.sanitize|sanitize(?:Env|Environment)|filterEnv)")
                            .is_match(&window(&lines, i, 3, 3))
                    {
                        continue;
                    }
                    (
                        "medium",
                        format!(
                            "process.env spread to child process at line {ln} without sanitization. Secrets (API keys, tokens) may leak to subprocesses."
                        ),
                    )
                }
                "missing_validation" => {
                    let Some(capture) =
                        re!(r#"\.\s*(?:post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]"#)
                            .captures(line)
                    else {
                        continue;
                    };
                    if re!(r"validator\s*\(").is_match(&window(&lines, i, 0, 4)) {
                        continue;
                    }
                    (
                        "medium",
                        format!(
                            "Mutation route \"{}\" at line {ln} without schema validation middleware. Unvalidated input may cause unexpected behavior.",
                            &capture[1]
                        ),
                    )
                }
                "ssrf" => {
                    let Some(capture) =
                        re!(r"(?:fetch|axios\.(?:get|post|put|delete|patch|request))\s*\(\s*(\w+)")
                            .captures(line)
                    else {
                        continue;
                    };
                    if re!(r"(?:assertPublicUrl|assertLoopbackHttpUrl|isPublic|validateUrl|Ssrf\.|allowedHosts|urlAllowlist)").is_match(&window(&lines, i, 10, 2)) { continue; }
                    (
                        "high",
                        format!(
                            "fetch/request with variable URL `{}` at line {ln} without URL validation. May allow SSRF to internal services.",
                            &capture[1]
                        ),
                    )
                }
                _ => unreachable!(),
            };
            findings.push(json!({ "file": file, "line": ln, "pattern": kind, "severity": severity, "description": description, "ruleId": format!("axcode:detect-security-{}", kind.replace('_', "-")) }));
        }
    }
    Ok(findings)
}

struct Scope {
    start: usize,
    end: usize,
    content: String,
}
fn scopes(source: &str, cancelled: &AtomicBool) -> Result<Vec<Scope>> {
    let lines: Vec<_> = source.split('\n').collect();
    let mut scopes = Vec::new();
    let mut depth = 0i64;
    let mut start = None;
    for (i, line) in lines.iter().enumerate() {
        check(cancelled)?;
        if depth == 0 && !re!(r"^\s*(?:if|for|while|switch|catch|class)\s*\(").is_match(line)
            && re!(r"(?:function\s+\w+|(?:async\s+)?(?:\w+\s*\(|=>\s*\{)|\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{)").is_match(line) { start = Some(i); }
        for ch in line.chars() {
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
                if depth == 0 {
                    if let Some(first) = start.take() {
                        scopes.push(Scope {
                            start: first + 1,
                            end: i + 1,
                            content: lines[first..=i].join("\n"),
                        });
                    }
                }
            }
        }
    }
    Ok(scopes)
}

fn lifecycle(
    source: &str,
    file: &str,
    input: &Input,
    cancelled: &AtomicBool,
) -> Result<Vec<Value>> {
    let lines: Vec<_> = source.split('\n').collect();
    let scopes = scopes(source, cancelled)?;
    let mut findings = Vec::new();
    let suppress = re!(r"//\s*@scan-suppress\s+lifecycle_scan");
    let rules: [(&str, &Regex, Vec<&Regex>, &str, &str); 5] = [
        (
            "event_listener",
            re!(r#"(\w+)\.(?:on|addEventListener)\s*\(\s*["'`](\w+)["'`]"#),
            vec![re!(
                r"\.(?:off|removeEventListener|removeListener|removeAllListeners)\s*\("
            )],
            "medium",
            "Event listener registered without corresponding removal",
        ),
        (
            "timer",
            re!(r"(?:setInterval|setTimeout)\s*\("),
            vec![re!(r"clearInterval\s*\("), re!(r"clearTimeout\s*\(")],
            "high",
            "setInterval/setTimeout without corresponding clear \u{2014} timer will run indefinitely",
        ),
        (
            "subscription",
            re!(r"(?:Bus\.subscribe|\.subscribe(?:All)?)\s*\("),
            vec![re!(r"unsub\s*\(|unsubscribe\s*\(")],
            "medium",
            "Subscription created without unsubscribe \u{2014} may cause memory leaks",
        ),
        (
            "abort_controller",
            re!(r"new\s+AbortController\s*\("),
            vec![re!(r"\.abort\s*\("), re!(r"\.signal")],
            "medium",
            "AbortController created but never aborted or signal never passed to dependent operation",
        ),
        (
            "child_process",
            re!(r"(?:^|[^\w.])(?:spawn|execFile|exec|fork)\s*\(|(?:Bun|Process)\.spawn\s*\("),
            vec![
                re!(r"\.kill\s*\("),
                re!(r#"\.on\s*\(\s*["'`](?:exit|close)["'`]"#),
            ],
            "high",
            "Child process spawned without kill or exit handler \u{2014} may become orphaned",
        ),
    ];
    for scope in &scopes {
        for (kind, create, cleanups, severity, description) in &rules {
            if !enabled(&input.patterns, kind) {
                continue;
            }
            for mat in create.find_iter(&scope.content) {
                check(cancelled)?;
                if findings.len() >= input.max_per_file {
                    break;
                }
                let line = scope.start
                    + scope.content[..mat.start()]
                        .bytes()
                        .filter(|&c| c == b'\n')
                        .count();
                if suppressed(&lines, line - 1, suppress)
                    || cleanups.iter().any(|r| r.is_match(&scope.content))
                {
                    continue;
                }
                if *kind == "event_listener"
                    && re!(r"(?:const|let|var)\s+\w+\s*=").is_match(lines[line - 1])
                {
                    continue;
                }
                findings.push(json!({ "file": file, "line": line, "resourceType": kind, "pattern": "no_cleanup", "severity": severity, "description": description,
                    "cleanupLocation": format!("within function scope (lines {}-{})", scope.start, scope.end), "ruleId": format!("axcode:detect-lifecycle-{}-no-cleanup", kind.replace('_', "-")) }));
            }
        }
    }
    if enabled(&input.patterns, "map_growth") {
        let mut setters: Vec<(String, Vec<usize>)> = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            check(cancelled)?;
            if suppress.is_match(line) {
                continue;
            }
            for capture in re!(r"(\w+)\.set\s*\(").captures_iter(line) {
                let name = &capture[1];
                if ["console", "Math", "JSON", "process"].contains(&name) {
                    continue;
                }
                if let Some((_, values)) = setters.iter_mut().find(|(n, _)| n == name) {
                    values.push(i + 1);
                } else {
                    setters.push((name.to_owned(), vec![i + 1]));
                }
            }
        }
        for (name, values) in setters {
            check(cancelled)?;
            if findings.len() >= input.max_per_file {
                break;
            }
            if source.contains(&format!("{name}.delete("))
                || source.contains(&format!("{name}.clear("))
                || js_regex(&format!(r"{}\.size\s*[><=!]", regex::escape(&name))).is_match(source)
                || !values
                    .iter()
                    .any(|ln| scopes.iter().any(|s| *ln >= s.start && *ln <= s.end))
            {
                continue;
            }
            let locations = values
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(",");
            findings.push(json!({ "file": file, "line": values[0], "resourceType": "map_growth", "pattern": "unbounded_growth", "severity": "medium", "cleanupLocation": null,
                "description": format!("Map/Set `{name}` grows via .set() (lines [{locations}]) but never .delete()/.clear() and has no .size guard. May grow without bounds in a hot path."),
                "ruleId": "axcode:detect-lifecycle-map-growth-unbounded-growth" }));
        }
    }
    Ok(findings)
}

fn strip_line_comments(line: &str) -> &str {
    if let Some(index) = line.find("//") {
        let prefix = &line[..index];
        if prefix.bytes().filter(|&c| c == b'"').count() % 2 == 0
            && prefix.bytes().filter(|&c| c == b'\'').count() % 2 == 0
        {
            return prefix;
        }
    }
    line
}
fn known_non_secret(value: &str) -> bool {
    if re!(r"^[A-Z][a-zA-Z0-9]*([A-Z][a-zA-Z0-9]*){2,}$").is_match(value)
        || re!(
            r"^[A-Z][A-Z0-9]*_[A-Z][A-Za-z0-9]*(?:Error|Exception|Warning|Event|Code|Status|Type)$"
        )
        .is_match(value)
        || re!(r"^[A-Za-z][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.-]+)+$").is_match(value)
        || re!(r"^[a-z][a-z0-9]*(_[a-z0-9]+)+$").is_match(value)
        || re!(r"^[a-z][a-z0-9]*(-[a-z0-9]+)+$").is_match(value)
        || (re!(r"^[A-Za-z0-9+/]+=*$").is_match(value) && value.ends_with('='))
        || re!(r"^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$").is_match(value)
    {
        return true;
    }
    if re!(r"^[A-Za-z0-9]+$").is_match(value)
        && value
            .bytes()
            .collect::<std::collections::HashSet<_>>()
            .len()
            == value.len()
    {
        return [
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "abcdefghijklmnopqrstuvwxyz",
            "0123456789",
        ]
        .iter()
        .any(|v| value.contains(v));
    }
    false
}
fn secret_shape(value: &str) -> bool {
    if value.len() < 30
        || !re!(r"^[A-Za-z0-9_\-+/=]+$").is_match(value)
        || (re!(r"^[a-fA-F0-9]+$").is_match(value) && value.len() <= 40)
        || known_non_secret(value)
    {
        return false;
    }
    let classes = [
        re!(r"[A-Z]").is_match(value),
        re!(r"[a-z]").is_match(value),
        re!(r"[0-9]").is_match(value),
        re!(r"[^A-Za-z0-9]").is_match(value),
    ];
    if classes.iter().filter(|&&v| v).count() < 3 {
        return false;
    }
    let mut counts = HashMap::new();
    for byte in value.bytes() {
        *counts.entry(byte).or_insert(0usize) += 1;
    }
    let entropy = counts
        .values()
        .map(|&count| {
            let p = count as f64 / value.len() as f64;
            -p * p.log2()
        })
        .sum::<f64>();
    entropy >= 3.5
}
fn word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn magic_numbers(line: &str) -> Vec<(usize, &str)> {
    let mut result = Vec::new();
    let bytes = line.as_bytes();
    for capture in re!(r"-?\d+(?:\.\d+)?").find_iter(line) {
        let mut start = capture.start();
        if start > 0 && (word(bytes[start - 1]) || bytes[start - 1] == b'.') {
            if bytes[start] == b'-' {
                start += 1;
            } else {
                continue;
            }
        }
        let mut end = capture.end();
        if bytes.get(end).is_some_and(|b| word(*b)) {
            if let Some(dot) = line[start..end].find('.') {
                end = start + dot;
            } else {
                continue;
            }
        }
        let value = &line[start..end];
        if ["0", "1", "-1", "2"].contains(&value) {
            continue;
        }
        let number = value.parse::<f64>().unwrap_or(f64::NAN);
        if number.fract() == 0.0 && (1900.0..=2100.0).contains(&number) {
            continue;
        }
        if start > 0 && bytes[start - 1] == b'[' && bytes.get(end) == Some(&b']') {
            continue;
        }
        result.push((start, value));
    }
    result
}

fn hardcodes(
    source: &str,
    file: &str,
    input: &Input,
    cancelled: &AtomicBool,
) -> Result<Vec<Value>> {
    let mut findings = Vec::new();
    let mut in_block = false;
    for (i, original) in source.split('\n').enumerate() {
        check(cancelled)?;
        if trim(original).is_empty() {
            continue;
        }
        let mut offset = 0;
        let mut remaining = original.to_owned();
        if in_block {
            let Some(end) = remaining.find("*/") else {
                continue;
            };
            offset = units(&remaining[..end + 2]);
            remaining = remaining[end + 2..].to_owned();
            in_block = false;
        }
        let mut search = 0;
        while let Some(rel) = remaining[search..].find("/*") {
            let start = search + rel;
            if let Some(rel_end) = remaining[start + 2..].find("*/") {
                let end = start + 2 + rel_end + 2;
                let padding = " ".repeat(units(&remaining[start..end]));
                remaining.replace_range(start..end, &padding);
                search = start + 1;
            } else {
                remaining.truncate(start);
                in_block = true;
                break;
            }
        }
        let trimmed = trim(&remaining);
        if trimmed.is_empty() || trimmed.starts_with("//") {
            continue;
        }
        let line = strip_line_comments(&remaining);
        let constant =
            re!(r"^\s*(export\s+)?(const|let|var)\s+[A-Z_a-z]\w*\s*(:[^=]+)?=").is_match(trimmed);
        for kind in [
            "magic_number",
            "inline_url",
            "inline_path",
            "inline_secret_shape",
        ] {
            if !enabled(&input.patterns, kind) {
                continue;
            }
            let hits: Vec<(usize, &str)> = match kind {
                "magic_number" => {
                    if re!(r"^\s*(export\s+)?(const|let|var)\s+[A-Z_][A-Z0-9_]*\s*(:[^=]+)?=")
                        .is_match(trimmed)
                        || re!(r"^\s*(export\s+)?(enum|type)\s").is_match(trimmed)
                    {
                        continue;
                    }
                    magic_numbers(line)
                }
                "inline_url" => {
                    if constant {
                        continue;
                    }
                    re!(r#"https?://[^\s"')<>]+"#)
                        .find_iter(line)
                        .map(|m| (m.start(), m.as_str()))
                        .collect()
                }
                "inline_path" | "inline_secret_shape" => {
                    if kind == "inline_path" && constant {
                        continue;
                    }
                    let mut hits = Vec::new();
                    for (start, byte) in line.bytes().enumerate() {
                        if !matches!(byte, b'\'' | b'"' | b'`') {
                            continue;
                        }
                        let rest = &line[start + 1..];
                        let Some(end) = rest.find(['\'', '"', '`']) else {
                            continue;
                        };
                        if rest.as_bytes()[end] != byte {
                            continue;
                        }
                        let value = &rest[..end];
                        let matches = if kind == "inline_path" {
                            re!(r"^(?:/Users/|/home/|/opt/|/var/|/etc/|/tmp/|[A-Z]:\\)")
                                .is_match(value)
                        } else {
                            secret_shape(value)
                        };
                        if matches {
                            hits.push((start, value));
                        }
                    }
                    hits
                }
                _ => unreachable!(),
            };
            for (column, value) in hits {
                check(cancelled)?;
                if findings.len() >= input.max_per_file {
                    break;
                }
                let (severity, suggestion) = match kind {
                    "inline_secret_shape" => {
                        ("high", "Move to environment variable or secret manager")
                    }
                    "inline_path" => ("medium", "Use a path resolver relative to the project root"),
                    "inline_url" => (
                        if re!(r"localhost|127\.0\.0\.1|0\.0\.0\.0").is_match(value) {
                            "low"
                        } else {
                            "medium"
                        },
                        "Move to config.ts or .env",
                    ),
                    _ => (
                        if value
                            .parse::<f64>()
                            .is_ok_and(|n| n.is_finite() && n.abs() >= 1000.0)
                        {
                            "medium"
                        } else {
                            "low"
                        },
                        "Extract to a named constant in config.ts",
                    ),
                };
                let value = if units(value) > 120 {
                    let prefix =
                        String::from_utf16(&value.encode_utf16().take(117).collect::<Vec<_>>())
                            .map_err(|_| {
                                napi::Error::from_reason(
                                    "Diagnostic value needs JavaScript surrogate fallback",
                                )
                            })?;
                    format!("{prefix}...")
                } else {
                    value.to_owned()
                };
                findings.push(json!({ "file": file, "line": i + 1, "column": units(&line[..column]) + 1 + offset,
                    "kind": kind, "value": value, "severity": severity, "suggestion": suggestion, "ruleId": format!("axcode:detect-hardcodes-{}", kind.replace('_', "-")) }));
            }
        }
        if findings.len() >= input.max_per_file {
            break;
        }
    }
    Ok(findings)
}

pub struct DiagnosticTask {
    input_json: String,
    cancelled: Arc<AtomicBool>,
}
impl Task for DiagnosticTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        check(&self.cancelled)?;
        if self.input_json.len() > 256 * 1024 {
            return Err(napi::Error::from_reason("Diagnostic input limit exceeded"));
        }
        let input: Input = serde_json::from_str(&self.input_json)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        if input.files.len() > 32
            || input.max_per_file > 1000
            || !["security", "lifecycle", "hardcodes"].contains(&input.kind.as_str())
        {
            return Err(napi::Error::from_reason("Invalid diagnostic batch limits"));
        }
        let mut findings = Vec::new();
        for file in &input.files {
            check(&self.cancelled)?;
            let handle = File::open(file)
                .map_err(|_| napi::Error::from_reason("Native diagnostic input unreadable"))?;
            let mut reader = CancellableReader {
                inner: handle.take(8 * 1024 * 1024 + 1),
                cancelled: &self.cancelled,
            };
            let mut bytes = Vec::new();
            if reader.read_to_end(&mut bytes).is_err() {
                check(&self.cancelled)?;
                return Err(napi::Error::from_reason("Native diagnostic read failed"));
            }
            if bytes.len() > 8 * 1024 * 1024 {
                return Err(napi::Error::from_reason("Diagnostic source limit exceeded"));
            }
            let content = String::from_utf8_lossy(&bytes);
            let values = match input.kind.as_str() {
                "security" => security(&content, file, &input, &self.cancelled)?,
                "lifecycle" => lifecycle(&content, file, &input, &self.cancelled)?,
                _ => hardcodes(&content, file, &input, &self.cancelled)?,
            };
            findings.extend(values);
        }
        check(&self.cancelled)?;
        serde_json::to_string(&json!({ "findings": findings }))
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancelled)?;
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<string>")]
pub fn detect_files_async(
    input_json: String,
    cancellation: &ScanCancellation,
) -> AsyncTask<DiagnosticTask> {
    AsyncTask::new(DiagnosticTask {
        input_json,
        cancelled: cancellation.cancelled.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn javascript_character_classes_and_safe_paths() {
        assert!(re!(r"\s").is_match("\u{FEFF}"));
        assert!(!re!(r"\w").is_match("\u{03B1}"));
        assert!(safe_path_call("path.join(os.tmpdir(), 'scratch')"));
        assert!(!safe_path_call("path.join(os.tmpdir(), user)"));
    }
    #[test]
    fn scope_and_hardcode_columns_match_javascript() {
        let input = Input {
            kind: "hardcodes".into(),
            files: vec![],
            patterns: vec!["magic_number".into()],
            max_per_file: 20,
        };
        let findings = hardcodes(
            "/* \u{1F600} */ call(42)\n/* block\nend */ call(55)",
            "fixture.ts",
            &input,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(findings[0]["column"], 15);
        assert_eq!(findings[1]["column"], 13);
    }
}
