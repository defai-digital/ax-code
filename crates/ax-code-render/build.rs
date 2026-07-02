extern crate napi_build;

fn main() {
    napi_build::setup();

    // Vendored facebook/yoga v3.2.1 — the same tag upstream OpenTUI pins in
    // its Zig build (build.zig.zon), so layout behavior is bit-identical.
    let yoga_root = std::path::Path::new("vendor/yoga");
    let mut sources = Vec::new();
    collect_cpp(&yoga_root.join("yoga"), &mut sources);
    sources.sort();

    let mut build = cc::Build::new();
    build.cpp(true).std("c++20").include(yoga_root);
    for src in &sources {
        build.file(src);
        println!("cargo:rerun-if-changed={}", src.display());
    }
    build.compile("yogacore");
}

fn collect_cpp(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in
        std::fs::read_dir(dir).expect("vendor/yoga/yoga missing — vendored yoga source required")
    {
        let path = entry.expect("readdir").path();
        if path.is_dir() {
            collect_cpp(&path, out);
        } else if path.extension().is_some_and(|e| e == "cpp") {
            out.push(path);
        }
    }
}
