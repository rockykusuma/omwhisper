#!/usr/bin/env python3
"""
Generate OmWhisper macOS icons from the source Square310x310Logo.png.
Produces: icon.png, icon.icns, 32x32.png, 128x128.png, 128x128@2x.png,
          tray-icon.png (22x22), tray-icon@2x.png (44x44)
"""

import subprocess
import shutil
from pathlib import Path
from PIL import Image, ImageOps

ICONS_DIR = Path(__file__).parent.parent / "src-tauri" / "icons"
SOURCE    = ICONS_DIR / "Square310x310Logo.png"


def make_tray_icon(src: Image.Image, size: int) -> Image.Image:
    """
    Derive a monochrome template icon for the macOS menu bar.
    - Removes background (sampled from corner)
    - Auto-crops tight to the symbol bounds
    - Re-pads to a square with ~8% margin then scales to `size`
    """
    # Work at 4× for clean anti-aliasing when downscaling
    work_size = size * 8
    img = src.convert("RGBA").resize((work_size, work_size), Image.LANCZOS)
    pixels = img.load()

    # Sample background from 3×3 top-left corner
    bg_samples = [pixels[x, y][:3] for x in range(3) for y in range(3)]
    bg_r = sum(s[0] for s in bg_samples) // len(bg_samples)
    bg_g = sum(s[1] for s in bg_samples) // len(bg_samples)
    bg_b = sum(s[2] for s in bg_samples) // len(bg_samples)

    threshold = 40
    for y in range(work_size):
        for x in range(work_size):
            r, g, b, a = pixels[x, y]
            if a < 30:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            dist = ((r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2) ** 0.5
            pixels[x, y] = (0, 0, 0, 0) if dist < threshold else (0, 0, 0, 255)

    # Auto-crop to the bounding box of the symbol
    bbox = img.getbbox()   # (left, upper, right, lower) of non-transparent pixels
    if bbox:
        img = img.crop(bbox)

    # Add ~1% padding on each side so the symbol fills the frame
    sym_w, sym_h = img.size
    pad = int(max(sym_w, sym_h) * 0.01)
    padded_size = max(sym_w, sym_h) + pad * 2
    canvas = Image.new("RGBA", (padded_size, padded_size), (0, 0, 0, 0))
    offset_x = (padded_size - sym_w) // 2
    offset_y = (padded_size - sym_h) // 2
    canvas.paste(img, (offset_x, offset_y), img)

    return canvas.resize((size, size), Image.LANCZOS)


def main():
    print("Generating OmWhisper icons from Square310x310Logo.png …")

    src = Image.open(str(SOURCE)).convert("RGBA")
    print(f"  Source: {SOURCE.name}  {src.size[0]}×{src.size[1]}")

    # ── App icon sizes ────────────────────────────────────────────────────────

    # 1024×1024 master (upscaled with LANCZOS — best quality for the .icns pipeline)
    icon_1024 = src.resize((1024, 1024), Image.LANCZOS)
    icon_1024.save(str(ICONS_DIR / "icon.png"))
    print("  Saved icon.png (1024×1024)")

    for size, name in [
        (32,  "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
    ]:
        icon_1024.resize((size, size), Image.LANCZOS).save(str(ICONS_DIR / name))
        print(f"  Saved {name}")

    # ── Tray icons ────────────────────────────────────────────────────────────

    for size, name in [(26, "tray-icon.png"), (52, "tray-icon@2x.png")]:
        make_tray_icon(src, size).save(str(ICONS_DIR / name))
        print(f"  Saved {name}")

    # ── icon.icns via iconutil ────────────────────────────────────────────────

    print("  Generating icon.icns …")
    iconset = ICONS_DIR / "icon.iconset"
    iconset.mkdir(exist_ok=True)

    for sz, fname in [
        (16,   "icon_16x16.png"),
        (32,   "icon_16x16@2x.png"),
        (32,   "icon_32x32.png"),
        (64,   "icon_32x32@2x.png"),
        (128,  "icon_128x128.png"),
        (256,  "icon_128x128@2x.png"),
        (256,  "icon_256x256.png"),
        (512,  "icon_256x256@2x.png"),
        (512,  "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]:
        icon_1024.resize((sz, sz), Image.LANCZOS).save(str(iconset / fname))

    result = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(ICONS_DIR / "icon.icns")],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print("  Saved icon.icns")
    else:
        print(f"  iconutil error: {result.stderr}")

    shutil.rmtree(str(iconset))

    print("\nDone!")


if __name__ == "__main__":
    main()
