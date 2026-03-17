fn main() {
    // Load .env from project root (one level up from src-tauri)
    let root_env = std::path::Path::new("../.env");
    if root_env.exists() {
        dotenvy::from_path(root_env).ok();
    }

    // Pass Rust-side keys as compile-time environment variables
    if let Ok(val) = std::env::var("APTABASE_APP_KEY") {
        println!("cargo:rustc-env=APTABASE_APP_KEY={}", val);
    }
    if let Ok(val) = std::env::var("SENTRY_DSN") {
        println!("cargo:rustc-env=SENTRY_DSN={}", val);
    }

    // Rebuild when .env changes
    println!("cargo:rerun-if-changed=../.env");

    // Tauri's own build step
    tauri_build::build();
}