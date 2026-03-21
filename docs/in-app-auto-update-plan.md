# In-App Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "Download" banner (which opens a browser) with a true in-app updater that downloads, verifies, and installs the new version then relaunches the app.

**Architecture:** Use `tauri-plugin-updater` (Tauri's first-party updater) which handles download, signature verification, and installation. The existing `updater.rs` custom check is replaced entirely. A new JSON endpoint format is published to `omwhisper.in/api/updater.json` alongside the existing `version.json`. Update artifacts are signed with a Tauri keypair; the private key lives in GitHub Actions secrets and in `.env` for local macOS builds.

**Tech Stack:** `tauri-plugin-updater` (Rust + TS), `@tauri-apps/plugin-updater` (npm), Tauri CLI signing, GitHub Actions (Windows), `scripts/build-release.sh` (macOS)

---

## File Map

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-updater` |
| `src-tauri/src/lib.rs` | Register plugin; remove manual `check_for_update` spawn |
| `src-tauri/src/updater.rs` | Delete — replaced by plugin |
| `src-tauri/src/commands.rs` | Remove `check_for_update` command; add `install_update` command |
| `src-tauri/capabilities/default.json` | Add updater permissions |
| `src-tauri/tauri.conf.json` | Add `[bundle.updater]` endpoint config |
| `src/App.tsx` | Replace update banner state/logic with plugin API |
| `src/types/index.ts` | Remove `UpdateInfo` type (no longer needed) |
| `scripts/build-release.sh` | Add `--bundles updater` flag; sign `.app.tar.gz` artifact |
| `.github/workflows/build-windows.yml` | Add `TAURI_SIGNING_PRIVATE_KEY` secret; upload `.msi` updater artifact |
| `landing/public/api/updater.json` | New file — Tauri updater endpoint (per-platform URLs + signatures) |

---

## Task 1: Generate Tauri signing keypair

**Files:**
- Create: `.env` entry `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Reference: `scripts/build-release.sh`

- [ ] **Step 1: Generate the keypair**

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/omwhisper.key
```

Expected output:
```
Please enter a password to protect the secret key:
...
Your public key: dW50cnVzdGVkIGNvbW1lbnQ6...
Your private key was saved to /Users/<you>/.tauri/omwhisper.key
```

- [ ] **Step 2: Copy the private key into `.env`**

Open `~/.tauri/omwhisper.key` and copy its contents. Add to `.env` (create if missing):

```bash
# .env (never commit this file)
TAURI_SIGNING_PRIVATE_KEY="<paste full contents of omwhisper.key here>"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<the password you entered>"
```

- [ ] **Step 3: Add the public key to `tauri.conf.json`**

```json
// src-tauri/tauri.conf.json  — inside the top-level object
"bundle": {
  "updater": {
    "active": true,
    "endpoints": ["https://omwhisper.in/api/updater.json"],
    "dialog": false,
    "pubkey": "<paste public key from step 1 output>"
  }
}
```

- [ ] **Step 4: Add `TAURI_SIGNING_PRIVATE_KEY` to GitHub Actions secrets**

Go to `https://github.com/rockykusuma/omwhisper/settings/secrets/actions` → New secret:
- Name: `TAURI_SIGNING_PRIVATE_KEY`  — value: full contents of `~/.tauri/omwhisper.key`
- Name: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — value: the password

- [ ] **Step 5: Verify `.env` is in `.gitignore`**

```bash
grep ".env" .gitignore
```

Expected: `.env` is listed. If not, add it:
```bash
echo ".env" >> .gitignore
```

---

## Task 2: Add `tauri-plugin-updater` to the Rust backend

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Delete: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the plugin to `Cargo.toml`**

```toml
# src-tauri/Cargo.toml — in [dependencies]
tauri-plugin-updater = "2"
```

- [ ] **Step 2: Register the plugin in `lib.rs`**

Find the `.plugin(tauri_plugin_opener::init())` line and add the updater plugin after it:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

- [ ] **Step 3: Remove the manual update check spawn from `lib.rs`**

Find and delete the block that spawns `crate::updater::check_for_update()` on startup (it emits `update-available`). The plugin replaces this entirely.

- [ ] **Step 4: Delete `src-tauri/src/updater.rs`**

```bash
rm src-tauri/src/updater.rs
```

Remove `mod updater;` from `lib.rs`.

- [ ] **Step 5: Add the `install_update` command to `commands.rs`**

Add this new command (this is what the frontend calls to trigger download + install):

```rust
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(()); // already up to date
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
```

Register it in `lib.rs` alongside the other commands in `.invoke_handler(tauri::generate_handler![...])`.

- [ ] **Step 6: Add updater permissions to `capabilities/default.json`**

```json
"updater:allow-check",
"updater:allow-download-and-install"
```

- [ ] **Step 7: Build and confirm it compiles**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished` with no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs \
        src-tauri/src/commands.rs src-tauri/capabilities/default.json \
        src-tauri/tauri.conf.json
git commit -m "feat: add tauri-plugin-updater to Rust backend"
```

---

## Task 3: Install the npm package and update the frontend

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Install the npm package**

```bash
npm install @tauri-apps/plugin-updater
```

- [ ] **Step 2: Remove `UpdateInfo` from `src/types/index.ts`**

Delete the `UpdateInfo` interface — it's no longer needed since the plugin owns the update metadata.

- [ ] **Step 3: Rewrite the update logic in `src/App.tsx`**

Remove:
- `const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);`
- The `listen("update-available", ...)` call
- The `UpdateInfo` import

Add these new state variables near the top of `App()`:

```tsx
const [updateAvailable, setUpdateAvailable] = useState(false);
const [updateNotes, setUpdateNotes] = useState("");
const [updateVersion, setUpdateVersion] = useState("");
const [isInstalling, setIsInstalling] = useState(false);
```

Add a `useEffect` to check for updates on mount (after the existing effects):

```tsx
useEffect(() => {
  import("@tauri-apps/plugin-updater").then(({ check }) => {
    check().then((update) => {
      if (update?.available) {
        setUpdateAvailable(true);
        setUpdateVersion(update.currentVersion); // latest version
        setUpdateNotes(update.body ?? "");
      }
    }).catch(() => {}); // silently ignore network errors
  });
}, []);
```

- [ ] **Step 4: Replace the update banner JSX in `App.tsx`**

Find the existing `{updateInfo && (...)}` block and replace it:

```tsx
{updateAvailable && (
  <div className="flex items-center justify-between px-5 py-2 shrink-0"
       style={{ background: "rgba(52,211,153,0.07)", boxShadow: "0 2px 8px var(--shadow-dark)" }}>
    <span className="text-emerald-400 text-xs">
      OmWhisper v{updateVersion} is available — {updateNotes}
    </span>
    <div className="flex items-center gap-3 shrink-0">
      <button
        disabled={isInstalling}
        onClick={async () => {
          setIsInstalling(true);
          await invoke("install_update").catch(() => setIsInstalling(false));
        }}
        className="text-emerald-400 text-xs underline hover:text-emerald-300 cursor-pointer bg-transparent border-0 p-0 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isInstalling ? "Installing…" : "Install & Restart"}
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        className="text-white/50 hover:text-white/60 text-xs cursor-pointer"
        aria-label="Dismiss update notification"
      >
        ✕
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/types/index.ts package.json package-lock.json
git commit -m "feat: replace update banner with in-app install via tauri-plugin-updater"
```

---

## Task 4: Update the macOS build script to produce signed updater artifacts

**Files:**
- Modify: `scripts/build-release.sh`

The Tauri updater for macOS needs a `.app.tar.gz` file alongside its `.sig` signature file, hosted somewhere the endpoint JSON can reference.

- [ ] **Step 1: Load signing env vars in `build-release.sh`**

The script already sources `.env`. Verify `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are exported from `.env` (Task 1 Step 2). No code change needed if `.env` is sourced.

- [ ] **Step 2: Add `--bundles app,dmg` to the build command in `build-release.sh`**

Find the `cargo tauri build` invocation and ensure it produces the `.app` bundle (needed to create the `.tar.gz`). Current command should already do this. Confirm the output path:

```bash
ls src-tauri/target/release/bundle/macos/
```

Expected: `OmWhisper.app` directory.

- [ ] **Step 3: Add a post-build step to create and sign the `.app.tar.gz`**

Add these lines to `build-release.sh` after the existing build command:

```bash
APP_BUNDLE="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/OmWhisper.app"
TAR_PATH="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/OmWhisper_${VERSION}_aarch64.app.tar.gz"

echo "Creating updater tarball..."
cd "$(dirname "$APP_BUNDLE")"
tar czf "$TAR_PATH" "OmWhisper.app"
cd "$PROJECT_ROOT"

echo "Signing updater tarball..."
npx @tauri-apps/cli signer sign "$TAR_PATH" \
  --private-key "$TAURI_SIGNING_PRIVATE_KEY" \
  --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"

echo "Updater artifact: $TAR_PATH"
echo "Signature:        ${TAR_PATH}.sig"
```

- [ ] **Step 4: Test the build script produces the artifacts**

```bash
bash scripts/build-release.sh 2>&1 | tail -20
```

Expected: prints paths to `.app.tar.gz` and `.app.tar.gz.sig`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-release.sh
git commit -m "feat: build-release.sh produces signed updater tarball"
```

---

## Task 5: Update the Windows CI workflow to produce signed updater artifacts

**Files:**
- Modify: `.github/workflows/build-windows.yml`

- [ ] **Step 1: Add signing secrets to the build step**

Find the `Build Tauri app` step and add the signing environment variables:

```yaml
- name: Build Tauri app
  run: npx @tauri-apps/cli build
  env:
    SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
    RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

- [ ] **Step 2: Upload the NSIS updater artifact**

Add an upload step for the `.nsis.zip` and `.sig` files (Tauri's Windows updater format):

```yaml
- name: Upload NSIS updater artifact
  uses: actions/upload-artifact@v4
  with:
    name: OmWhisper-Windows-Updater
    path: |
      src-tauri/target/release/bundle/nsis/*.nsis.zip
      src-tauri/target/release/bundle/nsis/*.nsis.zip.sig
    if-no-files-found: warn
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-windows.yml
git commit -m "feat: Windows CI produces signed updater artifacts"
```

---

## Task 6: Publish the updater JSON endpoint

**Files:**
- Create: `landing/public/api/updater.json`

This file is what `tauri-plugin-updater` polls. It must match Tauri's exact format. After every release, this file is updated manually (or via CI) with the new version, artifact URLs, and signatures.

- [ ] **Step 1: Create the initial `updater.json`**

```json
{
  "version": "0.1.0-beta.5",
  "notes": "Smart Dictation AI backend redesign, Ollama status banner, Cloud API verified persistence, Launch at Login, bug fixes.",
  "pub_date": "2026-03-21T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://github.com/rockykusuma/omwhisper/releases/download/v0.1.0-beta.5/OmWhisper_0.1.0-beta.5_aarch64.app.tar.gz",
      "signature": "<contents of OmWhisper_0.1.0-beta.5_aarch64.app.tar.gz.sig>"
    },
    "darwin-x86_64": {
      "url": "https://github.com/rockykusuma/omwhisper/releases/download/v0.1.0-beta.5/OmWhisper_0.1.0-beta.5_x64.app.tar.gz",
      "signature": "<contents of .sig file for x86_64 build if applicable>"
    },
    "windows-x86_64": {
      "url": "https://github.com/rockykusuma/omwhisper/releases/download/v0.1.0-beta.5/OmWhisper_0.1.0-beta.5_x64-setup.nsis.zip",
      "signature": "<contents of .nsis.zip.sig>"
    }
  }
}
```

> **Note:** The `signature` field value is the raw text content of the `.sig` file — not base64 encoded, just copy-paste the whole string.

- [ ] **Step 2: Upload the `.app.tar.gz` to the GitHub release**

After building with `build-release.sh`, upload the tarball:

```bash
gh release upload v0.1.0-beta.5 \
  src-tauri/target/release/bundle/macos/OmWhisper_0.1.0-beta.5_aarch64.app.tar.gz
```

- [ ] **Step 3: Deploy `updater.json` to production**

```bash
cd landing && npm run build && vercel --prod
```

Verify the endpoint is live:
```bash
curl https://omwhisper.in/api/updater.json | jq .version
```

Expected: `"0.1.0-beta.5"`

- [ ] **Step 4: Commit**

```bash
git add landing/public/api/updater.json
git commit -m "feat: publish Tauri updater JSON endpoint"
```

---

## Release Workflow (after this is implemented)

For every future release, do this in order:

1. Bump version in `src-tauri/Cargo.toml`
2. Run `bash scripts/build-release.sh` → produces `.dmg` + `.app.tar.gz` + `.app.tar.gz.sig`
3. Create GitHub release, upload `.dmg` and `.app.tar.gz`
4. Run Windows CI → produces `.nsis.zip` + `.nsis.zip.sig`, upload both to the release
5. Update `landing/public/api/updater.json` with new version, URLs, and `.sig` file contents
6. Deploy landing: `cd landing && npm run build && vercel --prod`

Users running the old version will see "Install & Restart" in the banner. Clicking it downloads, verifies the signature, installs, and relaunches automatically.

---

## Known Constraints

- **macOS x86_64**: If you only build on Apple Silicon, skip `darwin-x86_64` from `updater.json` — the plugin will gracefully skip it.
- **Windows updater format**: Tauri uses `.nsis.zip` (not the `.exe` installer) for in-app updates on Windows.
- **Signing is mandatory**: Without `TAURI_SIGNING_PRIVATE_KEY`, `cargo tauri build` will warn and the plugin will refuse to install unsigned updates.
- **Keep `version.json` alive**: The existing `version.json` can stay for now (it does no harm) but once `updater.json` is live, `updater.rs` and its custom logic are fully replaced.
