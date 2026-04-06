#[macro_use]
extern crate napi_derive;

use serde::{Deserialize, Serialize};
use tree_sitter::{Language, Node, Parser};

// ─── Symbol types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
  pub name: String,
  pub kind: String,
  pub qualified_name: String,
  pub range: Range,
  pub selection_range: Range,
  pub visibility: Option<String>,
  pub children: Vec<Symbol>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Range {
  pub start_line: u32,
  pub start_char: u32,
  pub end_line: u32,
  pub end_char: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInput {
  pub path: String,
  pub content: String,
  pub language: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSymbols {
  pub path: String,
  pub symbols: Vec<Symbol>,
  pub error: Option<String>,
}

// ─── Language registry ─────────────────────────────────────────────

fn get_language(name: &str) -> Option<Language> {
  match name {
    "typescript" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
    "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
    "javascript" | "jsx" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
    "python" => Some(tree_sitter_python::LANGUAGE.into()),
    "go" => Some(tree_sitter_go::LANGUAGE.into()),
    "rust" => Some(tree_sitter_rust::LANGUAGE.into()),
    "java" => Some(tree_sitter_java::LANGUAGE.into()),
    _ => None,
  }
}

fn range_from_node(node: &Node) -> Range {
  Range {
    start_line: node.start_position().row as u32,
    start_char: node.start_position().column as u32,
    end_line: node.end_position().row as u32,
    end_char: node.end_position().column as u32,
  }
}

fn node_text<'a>(node: &Node, source: &'a [u8]) -> &'a str {
  node.utf8_text(source).unwrap_or("")
}

// ─── Recursive symbol extraction ───────────────────────────────────

fn extract_from_node(node: Node, source: &[u8], parent_name: &str, lang: &str) -> Vec<Symbol> {
  let mut symbols = Vec::new();

  let mut cursor = node.walk();
  for child in node.children(&mut cursor) {
    let (name, kind, sel_node) = match classify_node(&child, source, lang) {
      Some(info) => info,
      None => {
        // Recurse into non-symbol nodes to find nested symbols
        symbols.extend(extract_from_node(child, source, parent_name, lang));
        continue;
      }
    };

    let qualified = if parent_name.is_empty() {
      name.clone()
    } else {
      format!("{parent_name}::{name}")
    };

    let range = range_from_node(&child);
    let sel_range = sel_node.map(|n| range_from_node(&n)).unwrap_or(range.clone());
    let visibility = detect_visibility(&child, source, lang);

    let children = extract_from_node(child, source, &qualified, lang);

    symbols.push(Symbol {
      name,
      kind,
      qualified_name: qualified,
      range,
      selection_range: sel_range,
      visibility,
      children,
    });
  }

  symbols
}

/// Classify a tree-sitter node into (name, kind, selection_node) or None.
fn classify_node<'a>(node: &Node<'a>, source: &[u8], lang: &str) -> Option<(String, String, Option<Node<'a>>)> {
  let kind = node.kind();

  match lang {
    "typescript" | "tsx" | "javascript" | "jsx" => classify_ts(node, source, kind),
    "python" => classify_python(node, source, kind),
    "go" => classify_go(node, source, kind),
    "rust" => classify_rust(node, source, kind),
    "java" => classify_java(node, source, kind),
    _ => None,
  }
}

fn find_child_by_field<'a>(node: &Node<'a>, field: &str) -> Option<Node<'a>> {
  node.child_by_field_name(field)
}

fn find_child_by_kind<'a>(node: &Node<'a>, kind: &str) -> Option<Node<'a>> {
  let mut cursor = node.walk();
  let result = node.children(&mut cursor).find(|c| c.kind() == kind);
  result
}

// ─── TypeScript / JavaScript classifier ────────────────────────────

fn classify_ts<'a>(node: &Node<'a>, source: &[u8], kind: &str) -> Option<(String, String, Option<Node<'a>>)> {
  match kind {
    "function_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "function".into(), Some(name_node)))
    }
    "class_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "class".into(), Some(name_node)))
    }
    "method_definition" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "method".into(), Some(name_node)))
    }
    "interface_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "interface".into(), Some(name_node)))
    }
    "type_alias_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "type".into(), Some(name_node)))
    }
    "enum_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "enum".into(), Some(name_node)))
    }
    "lexical_declaration" | "variable_declaration" => {
      let declarator = find_child_by_kind(node, "variable_declarator")?;
      let name_node = find_child_by_field(&declarator, "name")?;
      // Check if const (constant) or let/var (variable)
      let is_const = find_child_by_kind(node, "const").is_some();
      let sym_kind = if is_const { "constant" } else { "variable" };
      Some((node_text(&name_node, source).to_string(), sym_kind.into(), Some(name_node)))
    }
    "export_statement" => {
      // Delegate to the declaration inside the export
      let decl = find_child_by_field(node, "declaration")?;
      classify_ts(&decl, source, decl.kind())
    }
    "arrow_function" => {
      // Arrow functions need a parent variable_declarator for naming
      None // handled via lexical_declaration
    }
    _ => None,
  }
}

// ─── Python classifier ─────────────────────────────────────────────

fn classify_python<'a>(node: &Node<'a>, source: &[u8], kind: &str) -> Option<(String, String, Option<Node<'a>>)> {
  match kind {
    "function_definition" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "function".into(), Some(name_node)))
    }
    "class_definition" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "class".into(), Some(name_node)))
    }
    "decorated_definition" => {
      // Look inside for the actual definition
      let def = find_child_by_kind(node, "function_definition")
        .or_else(|| find_child_by_kind(node, "class_definition"))?;
      classify_python(&def, source, def.kind())
    }
    _ => None,
  }
}

// ─── Go classifier ─────────────────────────────────────────────────

fn classify_go<'a>(node: &Node<'a>, source: &[u8], kind: &str) -> Option<(String, String, Option<Node<'a>>)> {
  match kind {
    "function_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "function".into(), Some(name_node)))
    }
    "method_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "method".into(), Some(name_node)))
    }
    "type_declaration" => {
      let spec = find_child_by_kind(node, "type_spec")?;
      let name_node = find_child_by_field(&spec, "name")?;
      let type_kind = if find_child_by_kind(&spec, "struct_type").is_some() {
        "class"
      } else if find_child_by_kind(&spec, "interface_type").is_some() {
        "interface"
      } else {
        "type"
      };
      Some((node_text(&name_node, source).to_string(), type_kind.into(), Some(name_node)))
    }
    _ => None,
  }
}

// ─── Rust classifier ───────────────────────────────────────────────

fn classify_rust<'a>(node: &Node<'a>, source: &[u8], kind: &str) -> Option<(String, String, Option<Node<'a>>)> {
  match kind {
    "function_item" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "function".into(), Some(name_node)))
    }
    "struct_item" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "class".into(), Some(name_node)))
    }
    "enum_item" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "enum".into(), Some(name_node)))
    }
    "trait_item" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "interface".into(), Some(name_node)))
    }
    "impl_item" => {
      let type_node = find_child_by_field(node, "type")?;
      Some((node_text(&type_node, source).to_string(), "module".into(), Some(type_node)))
    }
    "mod_item" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "module".into(), Some(name_node)))
    }
    "const_item" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "constant".into(), Some(name_node)))
    }
    "type_item" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "type".into(), Some(name_node)))
    }
    _ => None,
  }
}

// ─── Java classifier ──────────────────────────────────────────────

fn classify_java<'a>(node: &Node<'a>, source: &[u8], kind: &str) -> Option<(String, String, Option<Node<'a>>)> {
  match kind {
    "class_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "class".into(), Some(name_node)))
    }
    "interface_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "interface".into(), Some(name_node)))
    }
    "method_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "method".into(), Some(name_node)))
    }
    "enum_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "enum".into(), Some(name_node)))
    }
    "constructor_declaration" => {
      let name_node = find_child_by_field(node, "name")?;
      Some((node_text(&name_node, source).to_string(), "method".into(), Some(name_node)))
    }
    _ => None,
  }
}

// ─── Visibility detection ──────────────────────────────────────────

fn detect_visibility(node: &Node, source: &[u8], lang: &str) -> Option<String> {
  match lang {
    "typescript" | "tsx" | "javascript" | "jsx" => {
      // Check for export keyword
      if node.parent().map(|p| p.kind() == "export_statement").unwrap_or(false) {
        return Some("public".into());
      }
      // Check for accessibility modifier in class methods
      let mut cursor = node.walk();
      for child in node.children(&mut cursor) {
        let text = node_text(&child, source);
        match text {
          "public" => return Some("public".into()),
          "private" => return Some("private".into()),
          "protected" => return Some("protected".into()),
          _ => {}
        }
      }
      None
    }
    "python" => {
      // Python convention: _ prefix = private, __ prefix = strongly private
      let name_node = find_child_by_field(node, "name")?;
      let name = node_text(&name_node, source);
      if name.starts_with("__") && !name.ends_with("__") {
        Some("private".into())
      } else if name.starts_with("_") {
        Some("protected".into())
      } else {
        Some("public".into())
      }
    }
    "go" => {
      // Go convention: uppercase first letter = exported
      let name_node = find_child_by_field(node, "name")?;
      let name = node_text(&name_node, source);
      if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
        Some("public".into())
      } else {
        Some("private".into())
      }
    }
    "rust" => {
      // Check for pub keyword
      let mut cursor = node.walk();
      for child in node.children(&mut cursor) {
        if child.kind() == "visibility_modifier" {
          return Some("public".into());
        }
      }
      Some("private".into())
    }
    "java" => {
      let mut cursor = node.walk();
      for child in node.children(&mut cursor) {
        if child.kind() == "modifiers" {
          let text = node_text(&child, source);
          if text.contains("public") { return Some("public".into()); }
          if text.contains("private") { return Some("private".into()); }
          if text.contains("protected") { return Some("protected".into()); }
        }
      }
      None
    }
    _ => None,
  }
}

// ─── Core extraction ───────────────────────────────────────────────

fn extract_symbols_internal(source: &str, language_name: &str) -> Result<Vec<Symbol>, String> {
  let lang = get_language(language_name)
    .ok_or_else(|| format!("unsupported language: {language_name}"))?;

  let mut parser = Parser::new();
  parser.set_language(&lang)
    .map_err(|e| format!("failed to set language: {e}"))?;

  let tree = parser.parse(source, None)
    .ok_or_else(|| "failed to parse source".to_string())?;

  Ok(extract_from_node(tree.root_node(), source.as_bytes(), "", language_name))
}

// ─── NAPI exports ──────────────────────────────────────────────────

#[napi]
pub fn extract_symbols(source: String, language: String) -> napi::Result<String> {
  match extract_symbols_internal(&source, &language) {
    Ok(symbols) => serde_json::to_string(&symbols)
      .map_err(|e| napi::Error::from_reason(e.to_string())),
    Err(e) => Err(napi::Error::from_reason(e)),
  }
}

#[napi]
pub fn parse_batch(files_json: String, _concurrency: u32) -> napi::Result<String> {
  let files: Vec<FileInput> = serde_json::from_str(&files_json)
    .map_err(|e| napi::Error::from_reason(format!("invalid JSON: {e}")))?;

  let results: Vec<FileSymbols> = files.iter().map(|f| {
    match extract_symbols_internal(&f.content, &f.language) {
      Ok(symbols) => FileSymbols { path: f.path.clone(), symbols, error: None },
      Err(e) => FileSymbols { path: f.path.clone(), symbols: Vec::new(), error: Some(e) },
    }
  }).collect();

  serde_json::to_string(&results).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn supported_languages() -> Vec<String> {
  vec![
    "typescript".into(), "tsx".into(),
    "javascript".into(), "jsx".into(),
    "python".into(), "go".into(),
    "rust".into(), "java".into(),
  ]
}

#[napi]
pub fn has_grammar(language: String) -> bool {
  get_language(&language).is_some()
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_typescript_symbols() {
    let source = r#"
export function greet(name: string): string {
  return `Hello, ${name}!`
}

class Animal {
  public name: string
  constructor(name: string) { this.name = name }
  speak(): string { return this.name }
}

interface Printable {
  print(): void
}

type ID = string | number

enum Color { Red, Green, Blue }

const MAX_SIZE = 100
"#;
    let symbols = extract_symbols_internal(source, "typescript").unwrap();
    let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"greet"), "should find function greet: {:?}", names);
    assert!(names.contains(&"Animal"), "should find class Animal: {:?}", names);
    assert!(names.contains(&"Printable"), "should find interface Printable: {:?}", names);
    assert!(names.contains(&"ID"), "should find type ID: {:?}", names);
    assert!(names.contains(&"Color"), "should find enum Color: {:?}", names);
    assert!(names.contains(&"MAX_SIZE"), "should find const MAX_SIZE: {:?}", names);
  }

  #[test]
  fn test_python_symbols() {
    let source = r#"
def greet(name):
    return f"Hello, {name}!"

class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return self.name

def _private_helper():
    pass
"#;
    let symbols = extract_symbols_internal(source, "python").unwrap();
    let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"greet"), "should find function greet: {:?}", names);
    assert!(names.contains(&"Animal"), "should find class Animal: {:?}", names);
    assert!(names.contains(&"_private_helper"), "should find _private_helper: {:?}", names);

    // Check Animal has children (methods)
    let animal = symbols.iter().find(|s| s.name == "Animal").unwrap();
    let child_names: Vec<&str> = animal.children.iter().map(|s| s.name.as_str()).collect();
    assert!(child_names.contains(&"__init__"), "Animal should have __init__: {:?}", child_names);
    assert!(child_names.contains(&"speak"), "Animal should have speak: {:?}", child_names);
  }

  #[test]
  fn test_go_symbols() {
    let source = r#"
package main

func Greet(name string) string {
    return "Hello, " + name
}

type Animal struct {
    Name string
}

func (a *Animal) Speak() string {
    return a.Name
}

type Printer interface {
    Print()
}
"#;
    let symbols = extract_symbols_internal(source, "go").unwrap();
    let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"Greet"), "should find function Greet: {:?}", names);
    assert!(names.contains(&"Animal"), "should find struct Animal: {:?}", names);
    assert!(names.contains(&"Speak"), "should find method Speak: {:?}", names);
    assert!(names.contains(&"Printer"), "should find interface Printer: {:?}", names);
  }

  #[test]
  fn test_rust_symbols() {
    let source = r#"
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

pub struct Animal {
    pub name: String,
}

impl Animal {
    pub fn speak(&self) -> &str {
        &self.name
    }
}

pub trait Printable {
    fn print(&self);
}

pub enum Color {
    Red,
    Green,
    Blue,
}

pub const MAX_SIZE: usize = 100;

type ID = u64;
"#;
    let symbols = extract_symbols_internal(source, "rust").unwrap();
    let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"greet"), "should find fn greet: {:?}", names);
    assert!(names.contains(&"Animal"), "should find struct Animal: {:?}", names);
    assert!(names.contains(&"Printable"), "should find trait Printable: {:?}", names);
    assert!(names.contains(&"Color"), "should find enum Color: {:?}", names);
    assert!(names.contains(&"MAX_SIZE"), "should find const MAX_SIZE: {:?}", names);
    assert!(names.contains(&"ID"), "should find type ID: {:?}", names);
  }

  #[test]
  fn test_java_symbols() {
    let source = r#"
public class Animal {
    private String name;

    public Animal(String name) {
        this.name = name;
    }

    public String speak() {
        return this.name;
    }
}

public interface Printable {
    void print();
}

public enum Color {
    RED, GREEN, BLUE
}
"#;
    let symbols = extract_symbols_internal(source, "java").unwrap();
    let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"Animal"), "should find class Animal: {:?}", names);
    assert!(names.contains(&"Printable"), "should find interface Printable: {:?}", names);
    assert!(names.contains(&"Color"), "should find enum Color: {:?}", names);
  }

  #[test]
  fn test_unsupported_language() {
    let result = extract_symbols_internal("code", "brainfuck");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("unsupported"));
  }

  #[test]
  fn test_has_grammar() {
    assert!(get_language("typescript").is_some());
    assert!(get_language("python").is_some());
    assert!(get_language("go").is_some());
    assert!(get_language("rust").is_some());
    assert!(get_language("java").is_some());
    assert!(get_language("brainfuck").is_none());
  }

  #[test]
  fn test_qualified_names() {
    let source = "class Foo {\n  bar() {}\n}\n";
    let symbols = extract_symbols_internal(source, "typescript").unwrap();
    let foo = symbols.iter().find(|s| s.name == "Foo").unwrap();
    assert!(!foo.children.is_empty(), "Foo should have children");
    let bar = &foo.children[0];
    assert_eq!(bar.qualified_name, "Foo::bar");
  }

  #[test]
  fn test_visibility_detection() {
    let source = r#"
pub fn public_fn() {}
fn private_fn() {}
"#;
    let symbols = extract_symbols_internal(source, "rust").unwrap();
    let pub_fn = symbols.iter().find(|s| s.name == "public_fn").unwrap();
    assert_eq!(pub_fn.visibility.as_deref(), Some("public"));
    let priv_fn = symbols.iter().find(|s| s.name == "private_fn").unwrap();
    assert_eq!(priv_fn.visibility.as_deref(), Some("private"));
  }
}
