fn main() {
    println!("cargo:rerun-if-env-changed=APTABASE_APP_KEY");
    println!("cargo:rerun-if-env-changed=SENTRY_DSN");
    tauri_build::build()
}
