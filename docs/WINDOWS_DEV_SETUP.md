# Windows Dev Setup — OmWhisper

Guide to building and running OmWhisper on a Windows x64 machine.

---

## Prerequisites

Install the following in order. Use PowerShell as Administrator.

### 1. Enable PowerShell Scripts

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 2. Node.js 20

```powershell
winget install OpenJS.NodeJS.LTS
```

Verify:
```powershell
node --version   # should print v20.x.x
npm --version
```

### 3. Rust

```powershell
winget install Rustlang.Rustup
```

Close and reopen PowerShell after installing, then verify:
```powershell
rustc --version
cargo --version
```

### 4. Visual Studio Build Tools (C++ workload)

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

This installs the MSVC linker (`link.exe`) required to compile Rust + whisper.cpp.

After install, verify:
```powershell
where.exe link.exe
```

If not found, activate the MSVC environment manually:
```powershell
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && set' | ForEach-Object { if ($_ -match "^(.*?)=(.*)$") { [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }
```

### 5. WebView2 Runtime

Usually pre-installed on Windows 10/11. If missing:
- Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

---

## Get the Code

Clone the repo (or copy the project folder):
```powershell
git clone https://github.com/rockykusuma/omwhisper.git
cd omwhisper
```

---

## Build

### Install frontend dependencies
```powershell
npm install
```

### Build the app
```powershell
npx @tauri-apps/cli build
```

First build takes **15–20 minutes** — Rust compiles everything from scratch including whisper.cpp.

The NSIS installer and `.exe` will be at:
```
src-tauri\target\release\bundle\nsis\OmWhisper_*_x64-setup.exe
```

---

## Dev Mode (fast iteration)

Instead of a full release build, run in dev mode for live reload:
```powershell
npx @tauri-apps/cli dev
```

> **Note:** Audio transcription requires a Whisper model. Download `ggml-tiny.en.bin` and place it at:
> `C:\Users\<you>\AppData\Roaming\com.omwhisper.app\models\ggml-tiny.en.bin`
>
> Or run the app first and use the built-in Model Manager to download it.

---

## Known Windows Limitations

| Feature | Status |
|---------|--------|
| Transcription (CPU) | Works |
| Auto-paste (SendInput) | Works |
| Toggle recording mode | Works |
| Push-to-Talk | Not supported (macOS only) |
| Built-in LLM | Not supported (macOS Metal only) |
| GPU acceleration | Not supported (macOS Metal only) |

---

## Troubleshooting

**`link.exe` not found**
Run the vcvars64.bat activation command above, then retry the build.

**`MSVCP140.dll` missing on the installed app**
The build uses `-C target-feature=+crt-static` to statically link the C runtime. If you see this on a CI/manual build that doesn't set this flag, add to your build command:
```powershell
$env:RUSTFLAGS="-C target-feature=+crt-static"
npx @tauri-apps/cli build
```

**`node_modules` errors after copying from Mac**
Mac-created `node_modules` has symlinks that break on Windows. Delete and reinstall:
```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

**WebView2 not found**
Install the WebView2 runtime from the Microsoft link above.
