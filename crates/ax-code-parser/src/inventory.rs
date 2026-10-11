use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tree_sitter::{Node, ParseOptions, Parser};

const MAX_SOURCE_UNITS: usize = 1_500_000;
const MAX_SYMBOLS: usize = 2_000;
const MAX_IMPORTS: usize = 256;

#[napi]
pub struct ParserCancellation {
    cancelled: Arc<AtomicBool>,
}

#[napi]
impl ParserCancellation {
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

fn check(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(napi::Error::from_reason("Native parser cancelled"));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlatSymbol {
    kind: String,
    name: String,
    qualified: String,
    start_line: usize,
    start_char: u32,
    end_line: usize,
    end_char: u32,
    signature: Option<String>,
}

#[derive(Debug, Serialize)]
struct ImportRef {
    specifier: String,
    line: usize,
}

#[derive(Debug, Serialize)]
struct Truncated {
    symbols: bool,
    imports: bool,
}

#[derive(Debug, Serialize)]
struct Inventory {
    symbols: Vec<FlatSymbol>,
    imports: Option<Vec<ImportRef>>,
    truncated: Truncated,
}

// O(source bytes) construction and O(1) position conversion, including long
// single-line generated input. Offsets are internal; public columns are UTF-16.
struct Positions {
    units: Vec<u32>,
    lines: Vec<usize>,
}

impl Positions {
    fn new(source: &str, cancelled: &AtomicBool) -> Result<Self> {
        let mut units = vec![0; source.len() + 1];
        let mut lines = vec![0];
        let mut total = 0u32;
        for (offset, ch) in source.char_indices() {
            if offset % 4096 < 4 {
                check(cancelled)?;
            }
            units[offset..offset + ch.len_utf8()].fill(total);
            total += ch.len_utf16() as u32;
            if ch == '\n' {
                lines.push(offset + 1);
            }
        }
        units[source.len()] = total;
        Ok(Self { units, lines })
    }
    fn column(&self, byte: usize, line: usize) -> u32 {
        self.units[byte] - self.units[self.lines[line]]
    }
}

fn text<'a>(node: Node, source: &'a str) -> &'a str {
    &source[node.byte_range()]
}

fn node_name(node: Node, source: &str) -> Option<String> {
    node.child_by_field_name("name")
        .map(|n| text(n, source))
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn signature(node: Node, source: &str) -> Option<String> {
    let params = node
        .child_by_field_name("parameters")
        .or_else(|| node.child_by_field_name("type_parameters"))?;
    let value = text(params, source);
    (value.encode_utf16().count() <= 200).then(|| value.to_owned())
}

fn qualify(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_owned()
    } else {
        format!("{prefix}::{name}")
    }
}

fn declaration(
    node: Node,
    kind: &str,
    prefix: &str,
    name: String,
    source: &str,
    positions: &Positions,
) -> FlatSymbol {
    let start = node.start_position();
    let end = node.end_position();
    FlatSymbol {
        qualified: qualify(prefix, &name),
        name,
        kind: kind.to_owned(),
        start_line: start.row,
        start_char: positions.column(node.start_byte(), start.row),
        end_line: end.row,
        end_char: positions.column(node.end_byte(), end.row),
        signature: if kind == "function" || kind == "method" {
            signature(node, source)
        } else {
            None
        },
    }
}

fn function_value(node: Node) -> bool {
    matches!(
        node.kind(),
        "arrow_function" | "function_expression" | "generator_function" | "function"
    )
}

fn push_symbol(
    symbols: &mut Vec<FlatSymbol>,
    budget: &mut usize,
    symbol: FlatSymbol,
) -> Result<()> {
    // Count worst-case JSON escaping before retaining repeated qualified names.
    *budget += 256
        + 6 * (symbol.name.len()
            + symbol.qualified.len()
            + symbol.signature.as_ref().map_or(0, String::len));
    if *budget > 32 * 1024 * 1024 {
        return Err(napi::Error::from_reason(
            "Native parser projection limit exceeded",
        ));
    }
    symbols.push(symbol);
    Ok(())
}

fn children<'a>(node: Node<'a>, prefix: &Arc<str>, stack: &mut Vec<(Node<'a>, Arc<str>)>) {
    for i in (0..node.named_child_count()).rev() {
        if let Some(child) = node.named_child(i) {
            stack.push((child, prefix.clone()));
        }
    }
}

fn js_symbols(
    root: Node,
    source: &str,
    positions: &Positions,
    cancelled: &AtomicBool,
) -> Result<(Vec<FlatSymbol>, bool)> {
    let mut symbols = Vec::new();
    let mut budget = 0usize;
    let mut stack = Vec::new();
    children(root, &Arc::from(""), &mut stack);
    while let Some((node, prefix)) = stack.pop() {
        check(cancelled)?;
        if symbols.len() >= MAX_SYMBOLS {
            return Ok((symbols, true));
        }
        let kind = match node.kind() {
            "export_statement" | "ambient_declaration" | "expression_statement" => {
                children(node, &prefix, &mut stack);
                continue;
            }
            "function_declaration" | "generator_function_declaration" => "function",
            "class_declaration" | "abstract_class_declaration" => "class",
            "interface_declaration" => "interface",
            "enum_declaration" => "enum",
            "type_alias_declaration" => "type",
            "internal_module" | "module" => "module",
            "lexical_declaration" | "variable_declaration" => {
                let is_const = text(node, source).starts_with("const");
                for i in 0..node.named_child_count() {
                    check(cancelled)?;
                    let Some(item) = node.named_child(i) else {
                        continue;
                    };
                    if item.kind() != "variable_declarator" {
                        continue;
                    }
                    let Some(name) = node_name(item, source) else {
                        continue;
                    };
                    let value = item.child_by_field_name("value");
                    let kind = if value.is_some_and(function_value) {
                        "function"
                    } else if is_const {
                        "constant"
                    } else {
                        "variable"
                    };
                    let mut symbol = declaration(item, kind, &prefix, name, source, positions);
                    if kind == "function" {
                        symbol.signature = value.and_then(|n| signature(n, source));
                    }
                    if symbols.len() >= MAX_SYMBOLS {
                        return Ok((symbols, true));
                    }
                    push_symbol(&mut symbols, &mut budget, symbol)?;
                }
                continue;
            }
            _ => continue,
        };
        let Some(name) = node_name(node, source) else {
            continue;
        };
        let qualified: Arc<str> = qualify(&prefix, &name).into();
        push_symbol(
            &mut symbols,
            &mut budget,
            declaration(node, kind, &prefix, name, source, positions),
        )?;
        if kind == "module" {
            if let Some(body) = node.child_by_field_name("body") {
                children(body, &qualified, &mut stack);
            }
        } else if kind == "class" {
            if let Some(body) = node.child_by_field_name("body") {
                for i in 0..body.named_child_count() {
                    check(cancelled)?;
                    let Some(member) = body.named_child(i) else {
                        continue;
                    };
                    let (kind, name) = match member.kind() {
                        "method_definition" => ("method", node_name(member, source)),
                        "public_field_definition" | "field_definition" => {
                            let value = member.child_by_field_name("value");
                            let kind = if value.is_some_and(function_value) {
                                "method"
                            } else {
                                "variable"
                            };
                            (
                                kind,
                                member
                                    .child_by_field_name("name")
                                    .or_else(|| member.child_by_field_name("property"))
                                    .map(|n| text(n, source).to_owned()),
                            )
                        }
                        _ => continue,
                    };
                    let Some(name) = name else {
                        continue;
                    };
                    if symbols.len() >= MAX_SYMBOLS {
                        return Ok((symbols, true));
                    }
                    push_symbol(
                        &mut symbols,
                        &mut budget,
                        declaration(member, kind, &qualified, name, source, positions),
                    )?;
                }
            }
        }
    }
    Ok((symbols, false))
}

fn native_symbols(
    root: Node,
    source: &str,
    language: &str,
    positions: &Positions,
    cancelled: &AtomicBool,
) -> Result<(Vec<FlatSymbol>, bool)> {
    let mut symbols = Vec::new();
    let mut budget = 0usize;
    let mut stack = vec![(root, Arc::<str>::from(""), 0usize)];
    let mut truncated = false;
    while let Some((node, prefix, depth)) = stack.pop() {
        check(cancelled)?;
        if depth > 64 {
            truncated = true;
            continue;
        }
        if symbols.len() >= MAX_SYMBOLS {
            return Ok((symbols, true));
        }
        let info = super::classify_node(&node, source.as_bytes(), language);
        let (next, next_depth) = if let Some((name, kind, _)) = info {
            let next: Arc<str> = qualify(&prefix, &name).into();
            let mut symbol = declaration(node, &kind, &prefix, name, source, positions);
            symbol.signature = None;
            push_symbol(&mut symbols, &mut budget, symbol)?;
            (next, depth + 1)
        } else {
            (prefix, depth)
        };
        for i in (0..node.child_count()).rev() {
            if let Some(child) = node.child(i) {
                stack.push((child, next.clone(), next_depth));
            }
        }
    }
    Ok((symbols, truncated))
}

fn string_value(node: Node, source: &str) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let raw = text(node, source);
    if raw.len() < 2 {
        return None;
    }
    let quote = raw.as_bytes()[0];
    if !matches!(quote, b'\'' | b'"' | b'`') || raw.as_bytes()[raw.len() - 1] != quote {
        return None;
    }
    let inner = &raw[1..raw.len() - 1];
    if inner.is_empty() || inner.encode_utf16().count() > 1024 || inner.contains("${") {
        return None;
    }
    Some(inner.to_owned())
}

fn import_specifier(node: Node, source: &str) -> Option<String> {
    if let Some(specifier) = node
        .child_by_field_name("source")
        .and_then(|n| string_value(n, source))
    {
        return Some(specifier);
    }
    if node.kind() != "call_expression" {
        return None;
    }
    let function = node.child_by_field_name("function")?;
    if function.kind() != "import"
        && !(function.kind() == "identifier" && text(function, source) == "require")
    {
        return None;
    }
    string_value(
        node.child_by_field_name("arguments")?.named_child(0)?,
        source,
    )
}

fn imports(root: Node, source: &str, cancelled: &AtomicBool) -> Result<(Vec<ImportRef>, bool)> {
    let mut refs = Vec::new();
    let mut stack = Vec::new();
    children(root, &Arc::from(""), &mut stack);
    while let Some((node, _)) = stack.pop() {
        check(cancelled)?;
        if refs.len() >= MAX_IMPORTS {
            return Ok((refs, true));
        }
        if let Some(specifier) = import_specifier(node, source) {
            refs.push(ImportRef {
                specifier,
                line: node.start_position().row,
            });
        }
        children(node, &Arc::from(""), &mut stack);
    }
    Ok((refs, false))
}

fn extract(source: &str, language: &str, cancelled: &AtomicBool) -> Result<Inventory> {
    check(cancelled)?;
    if source.len() > MAX_SOURCE_UNITS * 3 || source.encode_utf16().count() > MAX_SOURCE_UNITS {
        return Err(napi::Error::from_reason(
            "Native parser source limit exceeded",
        ));
    }
    let lang = super::get_language(language)
        .ok_or_else(|| napi::Error::from_reason(format!("unsupported language: {language}")))?;
    let mut parser = Parser::new();
    parser
        .set_language(&lang)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let mut progress = |_: &tree_sitter::ParseState| cancelled.load(Ordering::Relaxed);
    let bytes = source.as_bytes();
    let tree = parser
        .parse_with_options(
            &mut |offset, _| bytes.get(offset..).unwrap_or_default(),
            None,
            Some(ParseOptions::new().progress_callback(&mut progress)),
        )
        .ok_or_else(|| napi::Error::from_reason("Native parser cancelled or parse failed"))?;
    check(cancelled)?;
    let positions = Positions::new(source, cancelled)?;
    let is_js = matches!(
        language,
        "typescript" | "tsx" | "typescriptreact" | "javascript" | "jsx" | "javascriptreact"
    );
    let (symbols, symbols_truncated) = if is_js {
        js_symbols(tree.root_node(), source, &positions, cancelled)?
    } else {
        native_symbols(tree.root_node(), source, language, &positions, cancelled)?
    };
    let (imports, imports_truncated) = if is_js {
        let (refs, truncated) = imports(tree.root_node(), source, cancelled)?;
        (Some(refs), truncated)
    } else {
        (None, false)
    };
    check(cancelled)?;
    Ok(Inventory {
        symbols,
        imports,
        truncated: Truncated {
            symbols: symbols_truncated,
            imports: imports_truncated,
        },
    })
}

pub struct InventoryTask {
    source: String,
    language: String,
    cancelled: Arc<AtomicBool>,
}

impl Task for InventoryTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        let inventory = extract(&self.source, &self.language, &self.cancelled)?;
        let result = serde_json::to_string(&inventory)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        check(&self.cancelled)?;
        Ok(result)
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancelled)?;
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<string>")]
pub fn extract_inventory_async(
    source: String,
    language: String,
    cancellation: &ParserCancellation,
) -> AsyncTask<InventoryTask> {
    AsyncTask::new(InventoryTask {
        source,
        language,
        cancelled: cancellation.cancelled.clone(),
    })
}

#[derive(Serialize)]
struct FileInventory {
    path: String,
    inventory: Option<Inventory>,
    error: Option<String>,
}

pub struct InventoryBatchTask {
    files_json: String,
    concurrency: u32,
    cancelled: Arc<AtomicBool>,
}

impl Task for InventoryBatchTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        use rayon::prelude::*;
        check(&self.cancelled)?;
        if !(1..=8).contains(&self.concurrency) || self.files_json.len() > 32 * 1024 * 1024 {
            return Err(napi::Error::from_reason("Invalid parser batch limits"));
        }
        let files: Vec<super::FileInput> = serde_json::from_str(&self.files_json)
            .map_err(|e| napi::Error::from_reason(format!("Invalid parser batch: {e}")))?;
        if files.len() > 64
            || files.iter().map(|f| f.content.len()).sum::<usize>() > 24 * 1024 * 1024
        {
            return Err(napi::Error::from_reason(
                "Parser batch source limit exceeded",
            ));
        }
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(self.concurrency as usize)
            .build()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let results: Vec<_> = pool.install(|| {
            files
                .par_iter()
                .map(
                    |file| match extract(&file.content, &file.language, &self.cancelled) {
                        Ok(inventory) => FileInventory {
                            path: file.path.clone(),
                            inventory: Some(inventory),
                            error: None,
                        },
                        Err(error) => FileInventory {
                            path: file.path.clone(),
                            inventory: None,
                            error: Some(error.reason.clone()),
                        },
                    },
                )
                .collect()
        });
        check(&self.cancelled)?;
        serde_json::to_string(&results).map_err(|e| napi::Error::from_reason(e.to_string()))
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancelled)?;
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<string>")]
pub fn parse_batch_async(
    files_json: String,
    concurrency: u32,
    cancellation: &ParserCancellation,
) -> AsyncTask<InventoryBatchTask> {
    AsyncTask::new(InventoryBatchTask {
        files_json,
        concurrency,
        cancelled: cancellation.cancelled.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_long_qualified_names_have_a_projection_budget() {
        let source = format!(
            "namespace {} {{ {} }}",
            "n".repeat(100_000),
            (0..100)
                .map(|i| format!("export const v{i}=1;"))
                .collect::<String>()
        );
        let error = extract(&source, "typescript", &AtomicBool::new(false))
            .err()
            .unwrap();
        assert!(error.reason.contains("projection limit"));
    }

    #[test]
    fn flat_signatures_and_utf16_coordinates() {
        let value = extract("/* emoji: \u{1f600} */ const fnValue = (x: number) => x;\r\nclass Box { act(n: number) {} }", "typescript", &AtomicBool::new(false)).unwrap();
        assert_eq!(value.symbols[0].kind, "function");
        assert_eq!(value.symbols[0].signature.as_deref(), Some("(x: number)"));
        assert_eq!(value.symbols[0].start_char, 22);
        assert_eq!(value.symbols[2].qualified, "Box::act");
        assert_eq!(value.symbols[2].signature.as_deref(), Some("(n: number)"));
    }
    #[test]
    fn imports_preserve_raw_text_and_order() {
        let value = extract(
            "import a from './a'; const x=require('./b'); async function f(){await import('./c')}",
            "javascript",
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(
            value
                .imports
                .unwrap()
                .iter()
                .map(|r| r.specifier.as_str())
                .collect::<Vec<_>>(),
            ["./a", "./b", "./c"]
        );
    }
    #[test]
    fn caps_apply_before_serialization_and_cancellation_rejects() {
        let source = (0..2100)
            .map(|i| format!("function f{i}(){{}}\n"))
            .collect::<String>();
        let value = extract(&source, "javascript", &AtomicBool::new(false)).unwrap();
        assert_eq!(value.symbols.len(), MAX_SYMBOLS);
        assert!(value.truncated.symbols);
        assert!(extract(&source, "javascript", &AtomicBool::new(true)).is_err());
    }
}
