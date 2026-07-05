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
    if target_vendor_is_apple() && !archiver_config_env_is_set() {
        if let Some(wrapper) = install_darwin_ar_wrapper() {
            build.archiver(wrapper);
        }
    }
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

fn target_vendor_is_apple() -> bool {
    std::env::var("CARGO_CFG_TARGET_VENDOR").is_ok_and(|vendor| vendor == "apple")
}

fn archiver_config_env_is_set() -> bool {
    archiver_config_env_names()
        .iter()
        .any(|name| std::env::var_os(name).is_some())
}

fn archiver_config_env_names() -> Vec<String> {
    let target = std::env::var("TARGET").unwrap_or_default();
    let target_u = target.replace(['-', '.'], "_");
    let kind = match std::env::var("HOST") {
        Ok(host) if host == target => "HOST",
        _ => "TARGET",
    };
    let mut names = Vec::new();
    for env in ["AR", "ARFLAGS"] {
        names.push(format!("{env}_{target}"));
        names.push(format!("{env}_{target_u}"));
        names.push(format!("{kind}_{env}"));
        names.push(env.to_string());
    }
    for name in &names {
        println!("cargo:rerun-if-env-changed={name}");
    }
    names
}

#[cfg(unix)]
fn install_darwin_ar_wrapper() -> Option<std::path::PathBuf> {
    use std::os::unix::fs::PermissionsExt;

    let out_dir = std::env::var_os("OUT_DIR")?;
    let wrapper = std::path::PathBuf::from(out_dir).join("darwin-ar-wrapper.sh");
    let script = r#"#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
  mode=$1
  case "$mode" in
    *D*)
      shift
      mode=$(printf '%s' "$mode" | tr -d D)
      exec ar "$mode" "$@"
      ;;
  esac
fi

exec ar "$@"
"#;
    std::fs::write(&wrapper, script).expect("write darwin ar wrapper");
    let mut permissions = std::fs::metadata(&wrapper)
        .expect("stat darwin ar wrapper")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&wrapper, permissions).expect("chmod darwin ar wrapper");
    Some(wrapper)
}

#[cfg(not(unix))]
fn install_darwin_ar_wrapper() -> Option<std::path::PathBuf> {
    None
}
