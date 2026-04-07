#[cfg(target_os = "macos")]
fn compile_swift_shim() {
    let swift_src = "src/macos/speech_analyzer.swift";
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let lib_path = format!("{out_dir}/libspeech_analyzer.a");

    // Find the Swift toolchain lib directory (for Swift runtime linking)
    // swift binary is at something like:
    //   /Applications/Xcode.app/.../usr/bin/swift
    // We need: .../usr/lib/swift/macosx
    let swift_bin = std::process::Command::new("xcrun")
        .args(["--find", "swift"])
        .output()
        .expect("xcrun --find swift failed")
        .stdout;
    let swift_bin = std::str::from_utf8(&swift_bin).unwrap().trim();
    // Walk 4 parents up from the swift binary to reach the toolchain root,
    // then descend into usr/lib/swift/macosx
    let swift_lib = std::path::Path::new(swift_bin)
        .parent().unwrap()  // bin/
        .parent().unwrap()  // usr/
        .parent().unwrap()  // XcodeDefault.xctoolchain/
        .parent().unwrap()  // Toolchains/
        .join("XcodeDefault.xctoolchain/usr/lib/swift/macosx");

    // Get the macOS SDK path
    let sdk = std::process::Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
        .expect("xcrun --sdk macosx --show-sdk-path failed")
        .stdout;
    let sdk = std::str::from_utf8(&sdk).unwrap().trim();

    // Skip compilation if Swift source doesn't exist yet (e.g. during initial setup)
    if !std::path::Path::new(swift_src).exists() {
        println!("cargo:rerun-if-changed={swift_src}");
        return;
    }

    // Compile Swift source to object file, then archive into static lib
    let obj_path = format!("{out_dir}/speech_analyzer.o");
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_else(|_| "arm64".to_string());
    let swift_target = format!("{arch}-apple-macosx13.0");
    let status = std::process::Command::new("swiftc")
        .args([
            "-target", &swift_target,
            "-sdk", sdk,
            "-emit-object",
            "-o", &obj_path,
            swift_src,
        ])
        .status()
        .expect("swiftc failed to execute");
    assert!(status.success(), "swiftc compilation failed");

    let status = std::process::Command::new("ar")
        .args(["rcs", &lib_path, &obj_path])
        .status()
        .expect("ar failed");
    assert!(status.success(), "ar failed to create static lib");

    // Tell Cargo where to find the library and what to link
    println!("cargo:rustc-link-search=native={out_dir}");
    println!("cargo:rustc-link-lib=static=speech_analyzer");
    println!("cargo:rustc-link-search=native={}", swift_lib.display());
    println!("cargo:rustc-link-lib=dylib=swiftCore");
    println!("cargo:rustc-link-lib=dylib=swiftFoundation");
    // Speech and AVFoundation are required by the Swift shim
    println!("cargo:rustc-link-lib=framework=Speech");
    println!("cargo:rustc-link-lib=framework=AVFoundation");

    // Rebuild if Swift source changes
    println!("cargo:rerun-if-changed={swift_src}");
}

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

    #[cfg(target_os = "macos")]
    compile_swift_shim();

    #[cfg(target_os = "macos")]
    link_moonshine();

    // Tauri's own build step
    tauri_build::build();
}

/// Link the pre-built Moonshine shared library and its OnnxRuntime dependency.
///
/// Both dylibs live in src-tauri/Frameworks/ (gitignored).
/// Run scripts/setup-moonshine-sdk.sh once to populate that directory.
/// In the release .app bundle, tauri.conf.json `bundle.macOS.frameworks` places
/// them in Contents/Frameworks/ with @rpath automatically wired.
#[cfg(target_os = "macos")]
fn link_moonshine() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let frameworks = format!("{manifest_dir}/Frameworks");

    if !std::path::Path::new(&format!("{frameworks}/libmoonshine.dylib")).exists() {
        panic!(
            "\n\nlibmoonshine.dylib not found in {frameworks}/\n\
             Run: bash scripts/setup-moonshine-sdk.sh\n\n"
        );
    }

    // Both dylibs are in the same Frameworks/ directory.
    println!("cargo:rustc-link-search=native={frameworks}");
    println!("cargo:rustc-link-lib=dylib=moonshine");
    println!("cargo:rustc-link-lib=dylib=onnxruntime.1.23.2");

    println!("cargo:rerun-if-changed={frameworks}/libmoonshine.dylib");
    println!("cargo:rerun-if-changed={frameworks}/libonnxruntime.1.23.2.dylib");
}