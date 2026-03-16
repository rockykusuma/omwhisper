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
    - Keeps only pixels with HSV value > 0.25 AND saturation > 0.50
      (isolates the bright teal OM glyph, drops dark background and circle edge)
    - Auto-crops tight to the symbol bounds
    - Re-pads to a square with minimal margin then scales to `size`
    """
    import colorsys

    # Work at 8× for clean anti-aliasing when downscaling
    work_size = size * 8
    img = src.convert("RGBA").resize((work_size, work_size), Image.LANCZOS)
    pixels = img.load()

    for y in range(work_size):
        for x in range(work_size):
            r, g, b, a = pixels[x, y]
            if a < 30:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            h_, s_, v_ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            # Keep only the bright teal OM glyph — drop dark bg and circle outline
            pixels[x, y] = (0, 0, 0, 255) if (v_ > 0.25 and s_ > 0.50) else (0, 0, 0, 0)

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


def apply_squircle_mask(img: Image.Image) -> Image.Image:
    """
    Clip the image to a macOS-style squircle (rounded square).
    Corner radius ≈ 22.37 % of the icon size — matches the macOS dock shape.
    Renders the mask at 4× for smooth anti-aliased corners then downscales.
    """
    from PIL import ImageDraw
    size = img.size[0]          # assume square input
    scale = 4                   # supersample factor
    big = size * scale
    radius = int(big * 0.2237)  # macOS squircle corner ratio

    # Draw a white rounded-rectangle on a black mask at 4×
    mask_big = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask_big)
    draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)

    # Downsample the mask to icon size for smooth edges
    mask = mask_big.resize((size, size), Image.LANCZOS)

    # Apply mask to a transparent canvas
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.paste(img.resize((size, size), Image.LANCZOS), (0, 0), mask)
    return result


def main():
    print("Generating OmWhisper icons from Square310x310Logo.png …")

    src = Image.open(str(SOURCE)).convert("RGBA")
    print(f"  Source: {SOURCE.name}  {src.size[0]}×{src.size[1]}")

    # ── App icon sizes ────────────────────────────────────────────────────────

    # 1024×1024 master with macOS squircle shape applied
    icon_1024 = apply_squircle_mask(src.resize((1024, 1024), Image.LANCZOS))
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
