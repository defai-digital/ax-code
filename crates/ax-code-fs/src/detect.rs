//! Debug-engine detection logic ported from TypeScript.
//!
//! Implements security, lifecycle, and hardcodes scanners entirely in Rust
//! for parallel execution via rayon. The races scanner stays in TypeScript
//! because its async scope analysis requires language-aware state machines.

use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

// ─── Shared types ──────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult<F: Serialize> {
  pub findings: Vec<F>,
  pub files_scanned: usize,
  pub truncated: bool,
  pub elapsed_ms: u64,
  pub heuristics: Vec<String>,
}

fn is_suppressed(lines: &[&str], idx: usize, suppress_re: &Regex) -> bool {
  suppress_re.is_match(lines[idx]) || (idx > 0 && suppress_re.is_match(lines[idx - 1]))
}

// ─── Security scanner ──────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityFinding {
  pub file: String,
  pub line: usize,
  pub pattern: String,
  pub severity: String,
  pub description: String,
  pub user_controlled: bool,
}

struct SecurityPatterns {
  suppress: Regex,
  path_join: Regex,
  containment: Regex,
  all_literals: Regex,
  exec_inject: Regex,
  spawn_inject: Regex,
  env_spread: Regex,
  env_sanitize: Regex,
  route: Regex,
  validator: Regex,
  fetch_var: Regex,
  ssrf_guard: Regex,
}

impl SecurityPatterns {
  fn new() -> Self {
    Self {
      suppress: Regex::new(r"//\s*@scan-suppress\s+security_scan").unwrap(),
      path_join: Regex::new(r"path\.(?:join|resolve)\s*\((.+)").unwrap(),
      containment: Regex::new(r"(?:contains|containsPath|isSubpath|startsWith|Filesystem\.contains|within|inside)\s*\(").unwrap(),
      all_literals: Regex::new(r#"path\.(?:join|resolve)\s*\(\s*(?:["'`][^"'`]*["'`]\s*,?\s*)*\)"#).unwrap(),
      exec_inject: Regex::new(r#"(?:exec|execSync|execFile|execFileSync)\s*\(\s*(?:`[^`]*\$\{|[^,)]+\+)"#).unwrap(),
      spawn_inject: Regex::new(r#"(?:spawn|spawnSync)\s*\(\s*(?:`[^`]*\$\{|[^,)]+\+)"#).unwrap(),
      env_spread: Regex::new(r"env\s*:\s*\{?\s*\.\.\.process\.env").unwrap(),
      env_sanitize: Regex::new(r"(?:Env\.sanitize|sanitize(?:Env|Environment)|filterEnv)").unwrap(),
      route: Regex::new(r#"\.\s*(?:post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]"#).unwrap(),
      validator: Regex::new(r"validator\s*\(").unwrap(),
      fetch_var: Regex::new(r"(?:fetch|axios\.(?:get|post|put|delete|patch|request))\s*\(\s*(\w+)").unwrap(),
      ssrf_guard: Regex::new(r"(?:assertPublicUrl|isPublic|validateUrl|Ssrf\.|allowedHosts|urlAllowlist)").unwrap(),
    }
  }
}

fn nearby_window<'a>(lines: &[&'a str], idx: usize, before: usize, after: usize) -> String {
  let start = idx.saturating_sub(before);
  let end = (idx + after + 1).min(lines.len());
  lines[start..end].join("\n")
}

fn scan_security(content: &str, file: &str, enabled: &HashSet<String>, max: usize, patterns: &SecurityPatterns) -> Vec<SecurityFinding> {
  let lines: Vec<&str> = content.lines().collect();
  let mut findings = Vec::new();

  if enabled.contains("path_traversal") {
    for (i, line) in lines.iter().enumerate() {
      if findings.len() >= max { break }
      if is_suppressed(&lines, i, &patterns.suppress) { continue }
      if !patterns.path_join.is_match(line) { continue }
      let nearby = nearby_window(&lines, i, 5, 5);
      if patterns.containment.is_match(&nearby) { continue }
      let args_start = line.find("path.").unwrap_or(0);
      if patterns.all_literals.is_match(&line[args_start..]) { continue }
      findings.push(SecurityFinding {
        file: file.to_string(), line: i + 1, pattern: "path_traversal".into(),
        severity: "high".into(),
        description: format!("path.join/resolve with variable input at line {} without containment check", i + 1),
        user_controlled: true,
      });
    }
  }

  if enabled.contains("command_injection") {
    for (i, line) in lines.iter().enumerate() {
      if findings.len() >= max { break }
      if is_suppressed(&lines, i, &patterns.suppress) { continue }
      let is_exec = patterns.exec_inject.is_match(line);
      let is_spawn = patterns.spawn_inject.is_match(line);
      if !is_exec && !is_spawn { continue }
      findings.push(SecurityFinding {
        file: file.to_string(), line: i + 1, pattern: "command_injection".into(),
        severity: "high".into(),
        description: format!("{} with string interpolation/concatenation at line {}", if is_exec { "exec" } else { "spawn" }, i + 1),
        user_controlled: true,
      });
    }
  }

  if enabled.contains("env_leak") {
    for (i, line) in lines.iter().enumerate() {
      if findings.len() >= max { break }
      if is_suppressed(&lines, i, &patterns.suppress) { continue }
      if !patterns.env_spread.is_match(line) { continue }
      let nearby = nearby_window(&lines, i, 3, 3);
      if patterns.env_sanitize.is_match(&nearby) { continue }
      findings.push(SecurityFinding {
        file: file.to_string(), line: i + 1, pattern: "env_leak".into(),
        severity: "medium".into(),
        description: format!("process.env spread to child process at line {} without sanitization", i + 1),
        user_controlled: false,
      });
    }
  }

  if enabled.contains("missing_validation") {
    for (i, line) in lines.iter().enumerate() {
      if findings.len() >= max { break }
      if is_suppressed(&lines, i, &patterns.suppress) { continue }
      if !patterns.route.is_match(line) { continue }
      let after = nearby_window(&lines, i, 0, 5);
      if patterns.validator.is_match(&after) { continue }
      findings.push(SecurityFinding {
        file: file.to_string(), line: i + 1, pattern: "missing_validation".into(),
        severity: "medium".into(),
        description: format!("Mutation route at line {} without validator() middleware", i + 1),
        user_controlled: true,
      });
    }
  }

  if enabled.contains("ssrf") {
    for (i, line) in lines.iter().enumerate() {
      if findings.len() >= max { break }
      if is_suppressed(&lines, i, &patterns.suppress) { continue }
      if !patterns.fetch_var.is_match(line) { continue }
      let nearby = nearby_window(&lines, i, 10, 2);
      if patterns.ssrf_guard.is_match(&nearby) { continue }
      findings.push(SecurityFinding {
        file: file.to_string(), line: i + 1, pattern: "ssrf".into(),
        severity: "medium".into(),
        description: format!("fetch/axios with variable URL at line {} without SSRF validation", i + 1),
        user_controlled: true,
      });
    }
  }

  findings
}

// ─── Lifecycle scanner ─────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleFinding {
  pub file: String,
  pub line: usize,
  pub resource_type: String,
  pub pattern: String,
  pub severity: String,
  pub description: String,
  pub cleanup_location: Option<String>,
}

struct ResourceRule {
  rtype: &'static str,
  create_re: Regex,
  cleanup_patterns: Vec<Regex>,
  severity: &'static str,
  description: &'static str,
}

fn lifecycle_rules() -> Vec<ResourceRule> {
  vec![
    ResourceRule {
      rtype: "event_listener",
      create_re: Regex::new(r#"(\w+)\.(?:on|addEventListener)\s*\(\s*["'`](\w+)["'`]"#).unwrap(),
      cleanup_patterns: vec![Regex::new(r"\.(?:off|removeEventListener|removeListener|removeAllListeners)\s*\(").unwrap()],
      severity: "medium",
      description: "Event listener registered without corresponding removal",
    },
    ResourceRule {
      rtype: "timer",
      create_re: Regex::new(r"(?:setInterval|setTimeout)\s*\(").unwrap(),
      cleanup_patterns: vec![Regex::new(r"clearInterval\s*\(").unwrap(), Regex::new(r"clearTimeout\s*\(").unwrap()],
      severity: "high",
      description: "Timer created without clear",
    },
    ResourceRule {
      rtype: "subscription",
      create_re: Regex::new(r"(?:Bus\.subscribe|\.subscribe(?:All)?)\s*\(").unwrap(),
      cleanup_patterns: vec![Regex::new(r"(?:unsub|unsubscribe)\s*\(").unwrap()],
      severity: "medium",
      description: "Subscription without unsubscribe",
    },
    ResourceRule {
      rtype: "abort_controller",
      create_re: Regex::new(r"new\s+AbortController\s*\(").unwrap(),
      cleanup_patterns: vec![Regex::new(r"\.abort\s*\(").unwrap(), Regex::new(r"\.signal").unwrap()],
      severity: "medium",
      description: "AbortController without abort/signal usage",
    },
    ResourceRule {
      rtype: "child_process",
      create_re: Regex::new(r"(?:spawn|Bun\.spawn|exec|execFile|fork)\s*\(").unwrap(),
      cleanup_patterns: vec![
        Regex::new(r"\.kill\s*\(").unwrap(),
        Regex::new(r#"\.on\s*\(\s*["'`](?:exit|close)["'`]"#).unwrap(),
      ],
      severity: "high",
      description: "Child process without kill or exit handler",
    },
  ]
}

struct FunctionScope {
  start: usize,
  #[allow(dead_code)]
  end: usize,
  content: String,
}

fn find_function_scopes(content: &str) -> Vec<FunctionScope> {
  let func_re = Regex::new(r"(?:function\s+\w+|(?:async\s+)?(?:\w+\s*\(|=>\s*\{)|\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{)").unwrap();
  let control_re = Regex::new(r"\b(?:if|for|while|switch|catch|class)\s*\(").unwrap();
  let lines: Vec<&str> = content.lines().collect();
  let mut scopes = Vec::new();
  let mut depth: i32 = 0;
  let mut scope_start: Option<usize> = None;

  for (i, line) in lines.iter().enumerate() {
    if scope_start.is_none() && func_re.is_match(line) && !control_re.is_match(line) {
      scope_start = Some(i);
      depth = 0;
    }
    if scope_start.is_some() {
      let bytes = line.as_bytes();
      let len = bytes.len();
      let mut j = 0;
      while j < len {
        match bytes[j] {
          b'/' if j + 1 < len && bytes[j + 1] == b'/' => break, // line comment
          b'"' | b'\'' | b'`' => {
            let quote = bytes[j];
            j += 1;
            while j < len {
              if bytes[j] == b'\\' { j += 1; } // skip escaped char
              else if bytes[j] == quote { break; }
              j += 1;
            }
          }
          b'{' => depth += 1,
          b'}' => depth -= 1,
          _ => {}
        }
        j += 1;
      }
      if depth <= 0 && scope_start.is_some() {
        let start = scope_start.unwrap();
        if i > start {
          scopes.push(FunctionScope {
            start: start + 1,
            end: i + 1,
            content: lines[start..=i].join("\n"),
          });
        }
        scope_start = None;
        depth = 0;
      }
    }
  }
  scopes
}

fn scan_lifecycle(content: &str, file: &str, enabled: &HashSet<String>, max: usize) -> Vec<LifecycleFinding> {
  let suppress = Regex::new(r"//\s*@scan-suppress\s+lifecycle_scan").unwrap();
  let lines: Vec<&str> = content.lines().collect();
  let rules = lifecycle_rules();
  let scopes = find_function_scopes(content);
  let mut findings = Vec::new();

  // Resource leak detection per function scope
  for scope in &scopes {
    for rule in &rules {
      if !enabled.contains(rule.rtype) { continue }
      if findings.len() >= max { break }
      for mat in rule.create_re.find_iter(&scope.content) {
        if findings.len() >= max { break }
        let create_line_offset = scope.content[..mat.start()].lines().count();
        let global_line = scope.start + create_line_offset;
        if global_line > 0 && global_line <= lines.len() && is_suppressed(&lines, global_line - 1, &suppress) { continue }
        let has_cleanup = rule.cleanup_patterns.iter().any(|p| p.is_match(&scope.content));
        if has_cleanup { continue }
        findings.push(LifecycleFinding {
          file: file.to_string(),
          line: global_line,
          resource_type: rule.rtype.to_string(),
          pattern: "no_cleanup".into(),
          severity: rule.severity.to_string(),
          description: rule.description.to_string(),
          cleanup_location: None,
        });
      }
    }
  }

  // Unbounded map growth detection
  if enabled.contains("map_growth") && findings.len() < max {
    let map_set_re = Regex::new(r"(\w+)\.set\s*\(").unwrap();
    let map_delete_re = Regex::new(r"\.delete\s*\(").unwrap();
    let map_size_re = Regex::new(r"\.size\s*[><=!]").unwrap();
    let mut set_names: HashMap<String, usize> = HashMap::new();
    for mat in map_set_re.captures_iter(content) {
      let name = mat.get(1).unwrap().as_str().to_string();
      let line = content[..mat.get(0).unwrap().start()].lines().count() + 1;
      set_names.entry(name).or_insert(line);
    }
    for (name, line) in &set_names {
      if findings.len() >= max { break }
      if map_delete_re.is_match(content) || map_size_re.is_match(content) { continue }
      findings.push(LifecycleFinding {
        file: file.to_string(),
        line: *line,
        resource_type: "map_growth".into(),
        pattern: "unbounded_growth".into(),
        severity: "low".into(),
        description: format!("Map '{}' has .set() calls without .delete() or .size guard", name),
        cleanup_location: None,
      });
    }
  }

  findings
}

// ─── Hardcodes scanner ─────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardcodeFinding {
  pub file: String,
  pub line: usize,
  pub column: usize,
  pub kind: String,
  pub value: String,
  pub suggestion: String,
  pub severity: String,
}

fn shannon_entropy(s: &str) -> f64 {
  let mut counts: HashMap<char, usize> = HashMap::new();
  for ch in s.chars() { *counts.entry(ch).or_insert(0) += 1; }
  let len = s.len() as f64;
  let mut entropy = 0.0f64;
  for &count in counts.values() {
    let p = count as f64 / len;
    entropy -= p * p.log2();
  }
  entropy
}

fn has_char_class_diversity(s: &str) -> bool {
  let mut classes = 0u8;
  let mut has_upper = false;
  let mut has_lower = false;
  let mut has_digit = false;
  let mut has_special = false;
  for ch in s.chars() {
    if !has_upper && ch.is_ascii_uppercase() { has_upper = true; classes += 1; }
    if !has_lower && ch.is_ascii_lowercase() { has_lower = true; classes += 1; }
    if !has_digit && ch.is_ascii_digit() { has_digit = true; classes += 1; }
    if !has_special && !ch.is_ascii_alphanumeric() { has_special = true; classes += 1; }
    if classes >= 3 { return true }
  }
  false
}

fn strip_comments(line: &str, in_block: &mut bool) -> String {
  let mut out = String::new();
  let mut remaining = line;

  if *in_block {
    if let Some(close) = remaining.find("*/") {
      remaining = &remaining[close + 2..];
      *in_block = false;
    } else {
      return String::new();
    }
  }

  loop {
    if let Some(open) = remaining.find("/*") {
      out.push_str(&remaining[..open]);
      if let Some(close) = remaining[open + 2..].find("*/") {
        remaining = &remaining[open + 2 + close + 2..];
      } else {
        *in_block = true;
        break;
      }
    } else {
      out.push_str(remaining);
      break;
    }
  }

  // Strip line comment (naive: doesn't handle // inside strings)
  if let Some(lc) = out.find("//") {
    out.truncate(lc);
  }
  out
}

fn is_const_assignment(line: &str) -> bool {
  let re = Regex::new(r"^\s*(export\s+)?(const|let|var)\s+[A-Z_][A-Z0-9_]*\s*(:[^=]+)?=").unwrap();
  re.is_match(line)
}

fn scan_hardcodes(content: &str, file: &str, enabled: &HashSet<String>, max: usize) -> Vec<HardcodeFinding> {
  let suppress = Regex::new(r"//\s*@scan-suppress\s+hardcode_scan").unwrap();
  let lines: Vec<&str> = content.lines().collect();
  let mut findings = Vec::new();
  let mut in_block_comment = false;

  let magic_re = Regex::new(r"(?<!\w)(-?\d+(?:\.\d+)?)(?!\w)").unwrap();
  let enum_re = Regex::new(r"^\s*(export\s+)?(enum|type)\s").unwrap();
  let url_re = Regex::new(r#"https?://[^\s"')<>]+"#).unwrap();
  let path_re = Regex::new(r#"(["'`])(/(?:Users|home|opt|var|etc|tmp)/[^"'`]*|[A-Z]:\\[^"'`]*)\1"#).unwrap();
  let secret_re = Regex::new(r#"(["'`])([A-Za-z0-9_\-+/=]{20,})\1"#).unwrap();
  let class_name_re = Regex::new(r"^[A-Z][a-zA-Z0-9]*([A-Z][a-zA-Z0-9]*){2,}$").unwrap();
  let snake_re = Regex::new(r"^[a-z][a-z0-9]*(_[a-z0-9]+)+$").unwrap();
  let kebab_re = Regex::new(r"^[a-z][a-z0-9]*(-[a-z0-9]+)+$").unwrap();
  let hex_re = Regex::new(r"(?i)^[a-f0-9]+$").unwrap();
  let svg_re = Regex::new(r"^[MLHVCSQTAZmlhvcsqtaz0-9.,\s\-]+$").unwrap();

  let trivial: HashSet<&str> = ["0", "1", "-1", "2"].into_iter().collect();

  for (i, &line) in lines.iter().enumerate() {
    if findings.len() >= max { break }
    if is_suppressed(&lines, i, &suppress) { continue }

    let stripped = strip_comments(line, &mut in_block_comment);
    if stripped.trim().is_empty() { continue }
    let trimmed = stripped.trim();

    // Magic numbers
    if enabled.contains("magic_number") {
      if !is_const_assignment(line) && !enum_re.is_match(line) {
        for mat in magic_re.find_iter(trimmed) {
          if findings.len() >= max { break }
          let val = mat.as_str();
          if trivial.contains(val) { continue }
          // Skip years 1900-2100
          if let Ok(n) = val.parse::<f64>() {
            if n >= 1900.0 && n <= 2100.0 && !val.contains('.') { continue }
          }
          // Skip array indices like [0]
          let before = &trimmed[..mat.start()];
          let after_idx = mat.end();
          if before.ends_with('[') && after_idx < trimmed.len() && trimmed.as_bytes()[after_idx] == b']' { continue }

          let sev = if let Ok(n) = val.parse::<f64>() { if n.abs() >= 1000.0 { "medium" } else { "low" } } else { "low" };
          findings.push(HardcodeFinding {
            file: file.to_string(), line: i + 1, column: mat.start() + 1,
            kind: "magic_number".into(), value: val.to_string(),
            suggestion: "Extract to a named constant".into(), severity: sev.into(),
          });
        }
      }
    }

    // Inline URLs
    if enabled.contains("inline_url") && !is_const_assignment(line) {
      for mat in url_re.find_iter(trimmed) {
        if findings.len() >= max { break }
        let val = mat.as_str();
        let sev = if val.contains("localhost") || val.contains("127.0.0.1") || val.contains("0.0.0.0") { "low" } else { "medium" };
        findings.push(HardcodeFinding {
          file: file.to_string(), line: i + 1, column: mat.start() + 1,
          kind: "inline_url".into(), value: if val.len() > 120 { format!("{}...", &val[..117]) } else { val.to_string() },
          suggestion: "Move URL to configuration or environment variable".into(), severity: sev.into(),
        });
      }
    }

    // Inline paths
    if enabled.contains("inline_path") {
      for caps in path_re.captures_iter(trimmed) {
        if findings.len() >= max { break }
        let val = caps.get(2).unwrap().as_str();
        findings.push(HardcodeFinding {
          file: file.to_string(), line: i + 1, column: caps.get(0).unwrap().start() + 1,
          kind: "inline_path".into(), value: if val.len() > 120 { format!("{}...", &val[..117]) } else { val.to_string() },
          suggestion: "Use path.join() with a configurable base directory".into(), severity: "medium".into(),
        });
      }
    }

    // Secret shapes
    if enabled.contains("inline_secret_shape") {
      for caps in secret_re.captures_iter(trimmed) {
        if findings.len() >= max { break }
        let val = caps.get(2).unwrap().as_str();
        if val.len() < 30 { continue }
        if hex_re.is_match(val) && val.len() <= 40 { continue }
        if class_name_re.is_match(val) { continue }
        if snake_re.is_match(val) { continue }
        if kebab_re.is_match(val) { continue }
        if val.ends_with('=') && Regex::new(r"^[A-Za-z0-9+/]+=*$").unwrap().is_match(val) { continue }
        if svg_re.is_match(val) { continue }
        if !has_char_class_diversity(val) { continue }
        if shannon_entropy(val) < 3.5 { continue }

        findings.push(HardcodeFinding {
          file: file.to_string(), line: i + 1, column: caps.get(0).unwrap().start() + 1,
          kind: "inline_secret_shape".into(),
          value: if val.len() > 120 { format!("{}...", &val[..117]) } else { val.to_string() },
          suggestion: "Move to environment variable or secrets manager".into(),
          severity: "high".into(),
        });
      }
    }
  }

  findings
}

// ─── Top-level NAPI exports ────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectInput {
  pub cwd: String,
  pub include: Vec<String>,
  pub patterns: Vec<String>,
  #[serde(default = "default_500")]
  pub max_files: usize,
  #[serde(default = "default_20")]
  pub max_per_file: usize,
  #[serde(default)]
  pub exclude_tests: bool,
}

fn default_500() -> usize { 500 }
fn default_20() -> usize { 20 }

fn is_test_file(path: &str) -> bool {
  let test_dir = regex::Regex::new(r"(^|/)(test|tests|__tests__|__mocks__|spec)/").unwrap();
  let test_file = regex::Regex::new(r"\.(test|spec)\.[jt]sx?$").unwrap();
  test_dir.is_match(path) || test_file.is_match(path)
}

const EXCLUDE_DIRS: &[&str] = &["node_modules", "dist", "build", ".cache", ".git", ".next", "coverage"];

fn is_excluded_dir(rel_path: &str) -> bool {
  rel_path.split('/').any(|seg| EXCLUDE_DIRS.contains(&seg))
}

/// Detect security issues. Called from TypeScript via napi.
pub fn detect_security_native(input_json: &str) -> Result<String, String> {
  let start = std::time::Instant::now();
  let input: DetectInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
  let enabled: HashSet<String> = input.patterns.into_iter().collect();
  let mut heuristics = vec!["native-rust".to_string()];

  let files = collect_scan_files(&input.cwd, &input.include, input.max_files, input.exclude_tests)?;
  heuristics.push(format!("candidate-files={}", files.len()));
  let truncated = files.len() >= input.max_files;
  if truncated { heuristics.push("file-cap-hit".into()); }

  let patterns = SecurityPatterns::new();
  let scanned = AtomicUsize::new(0);

  let all_findings: Vec<Vec<SecurityFinding>> = files.par_iter().map(|(rel, full)| {
    scanned.fetch_add(1, Ordering::Relaxed);
    let content = match std::fs::read_to_string(full) { Ok(c) => c, Err(_) => return Vec::new() };
    scan_security(&content, rel, &enabled, input.max_per_file, &patterns)
  }).collect();

  let mut findings: Vec<SecurityFinding> = all_findings.into_iter().flatten().collect();
  let sev_rank = |s: &str| -> u8 { match s { "high" => 0, "medium" => 1, _ => 2 } };
  findings.sort_by(|a, b| {
    sev_rank(&a.severity).cmp(&sev_rank(&b.severity))
      .then_with(|| a.file.cmp(&b.file))
      .then_with(|| a.line.cmp(&b.line))
  });

  let result = DetectResult {
    findings, files_scanned: scanned.load(Ordering::Relaxed),
    truncated, elapsed_ms: start.elapsed().as_millis() as u64, heuristics,
  };
  serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Detect lifecycle issues. Called from TypeScript via napi.
pub fn detect_lifecycle_native(input_json: &str) -> Result<String, String> {
  let start = std::time::Instant::now();
  let input: DetectInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
  let enabled: HashSet<String> = input.patterns.into_iter().collect();
  let mut heuristics = vec!["native-rust".to_string()];

  let files = collect_scan_files(&input.cwd, &input.include, input.max_files, input.exclude_tests)?;
  heuristics.push(format!("candidate-files={}", files.len()));
  let truncated = files.len() >= input.max_files;
  if truncated { heuristics.push("file-cap-hit".into()); }

  let scanned = AtomicUsize::new(0);
  let all_findings: Vec<Vec<LifecycleFinding>> = files.par_iter().map(|(rel, full)| {
    scanned.fetch_add(1, Ordering::Relaxed);
    let content = match std::fs::read_to_string(full) { Ok(c) => c, Err(_) => return Vec::new() };
    scan_lifecycle(&content, rel, &enabled, input.max_per_file)
  }).collect();

  let mut findings: Vec<LifecycleFinding> = all_findings.into_iter().flatten().collect();
  let sev_rank = |s: &str| -> u8 { match s { "high" => 0, "medium" => 1, _ => 2 } };
  findings.sort_by(|a, b| {
    sev_rank(&a.severity).cmp(&sev_rank(&b.severity))
      .then_with(|| a.file.cmp(&b.file))
      .then_with(|| a.line.cmp(&b.line))
  });

  let result = DetectResult {
    findings, files_scanned: scanned.load(Ordering::Relaxed),
    truncated, elapsed_ms: start.elapsed().as_millis() as u64, heuristics,
  };
  serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Detect hardcoded values. Called from TypeScript via napi.
pub fn detect_hardcodes_native(input_json: &str) -> Result<String, String> {
  let start = std::time::Instant::now();
  let input: DetectInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
  let enabled: HashSet<String> = input.patterns.into_iter().collect();
  let mut heuristics = vec!["native-rust".to_string()];

  let files = collect_scan_files(&input.cwd, &input.include, input.max_files, input.exclude_tests)?;
  heuristics.push(format!("candidate-files={}", files.len()));
  let truncated = files.len() >= input.max_files;
  if truncated { heuristics.push("file-cap-hit".into()); }

  let scanned = AtomicUsize::new(0);
  let all_findings: Vec<Vec<HardcodeFinding>> = files.par_iter().map(|(rel, full)| {
    scanned.fetch_add(1, Ordering::Relaxed);
    let content = match std::fs::read_to_string(full) { Ok(c) => c, Err(_) => return Vec::new() };
    scan_hardcodes(&content, rel, &enabled, input.max_per_file)
  }).collect();

  let mut findings: Vec<HardcodeFinding> = all_findings.into_iter().flatten().collect();
  let sev_rank = |s: &str| -> u8 { match s { "high" => 0, "medium" => 1, _ => 2 } };
  findings.sort_by(|a, b| {
    sev_rank(&a.severity).cmp(&sev_rank(&b.severity))
      .then_with(|| a.file.cmp(&b.file))
      .then_with(|| a.line.cmp(&b.line))
  });

  let result = DetectResult {
    findings, files_scanned: scanned.load(Ordering::Relaxed),
    truncated, elapsed_ms: start.elapsed().as_millis() as u64, heuristics,
  };
  serde_json::to_string(&result).map_err(|e| e.to_string())
}

// ─── Shared file collection ────────────────────────────────────────

fn collect_scan_files(cwd: &str, include: &[String], max_files: usize, exclude_tests: bool) -> Result<Vec<(String, PathBuf)>, String> {
  let root = PathBuf::from(cwd);
  let globs: Vec<globset::GlobMatcher> = include.iter()
    .filter_map(|p| globset::Glob::new(p).ok().map(|g| g.compile_matcher()))
    .collect();

  let mut builder = ignore::WalkBuilder::new(&root);
  builder.hidden(true).git_ignore(true).git_global(true).git_exclude(true);

  let mut files = Vec::new();
  for entry in builder.build().flatten() {
    if files.len() >= max_files { break }
    if !entry.file_type().map_or(false, |ft| ft.is_file()) { continue }
    let full = entry.path().to_path_buf();
    let rel = match full.strip_prefix(&root) {
      Ok(p) => p,
      Err(_) => continue,
    };
    let rel_str = match rel.to_str() {
      Some(s) => s,
      None => continue,
    };
    if rel.components().any(|c| c.as_os_str() == ".git") { continue }
    if is_excluded_dir(rel_str) { continue }
    if exclude_tests && is_test_file(rel_str) { continue }
    if !globs.is_empty() && !globs.iter().any(|g| g.is_match(rel_str)) { continue }
    files.push((rel_str.to_string(), full));
  }
  Ok(files)
}
