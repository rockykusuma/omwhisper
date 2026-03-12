#!/usr/bin/env python3
"""
Generate OmWhisper app icons: dark background with ॐ symbol in emerald gradient.
Produces all required sizes for Tauri macOS bundling.
"""

import math
import os
import struct
import subprocess
import zlib
from pathlib import Path

ICONS_DIR = Path(__file__).parent.parent / "src-tauri" / "icons"
ICONS_DIR.mkdir(exist_ok=True)

# Colors
BG_COLOR = (10, 15, 13, 255)          # #0a0f0d
EMERALD_START = (52, 211, 153, 255)    # emerald-400
EMERALD_END = (16, 185, 129, 255)      # emerald-500
WHITE = (255, 255, 255, 255)


def make_png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    return length + chunk_type + data + crc


def save_png(pixels, width, height, filepath):
    """Write RGBA pixels as a PNG file."""
    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    # Wait — we use RGBA so bit depth=8, color type=6 (RGBA)
    ihdr_data = struct.pack(">II", width, height) + bytes([8, 6, 0, 0, 0])

    raw_rows = []
    for y in range(height):
        row = b"\x00"  # filter type None
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            row += bytes([r, g, b, a])
        raw_rows.append(row)

    compressed = zlib.compress(b"".join(raw_rows), 9)

    png = b"\x89PNG\r\n\x1a\n"
    png += make_png_chunk(b"IHDR", ihdr_data)
    png += make_png_chunk(b"IDAT", compressed)
    png += make_png_chunk(b"IEND", b"")

    filepath.write_bytes(png)


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(4))


def distance(x1, y1, x2, y2):
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def generate_icon(size: int) -> list:
    """Generate an icon of the given size using pure Python."""
    pixels = []
    cx, cy = size / 2, size / 2
    radius = size / 2

    # Corner radius for rounded square feel: ~22% of size
    corner_r = size * 0.22

    def in_rounded_rect(x, y, w, h, r):
        """Check if point (x,y) is inside a rounded rectangle."""
        # Corners
        if x < r and y < r:
            return distance(x, y, r, r) <= r
        if x > w - r and y < r:
            return distance(x, y, w - r, r) <= r
        if x < r and y > h - r:
            return distance(x, y, r, h - r) <= r
        if x > w - r and y > h - r:
            return distance(x, y, w - r, h - r) <= r
        return True

    # We'll draw the ॐ character using Pillow if available, else draw a stylized OM
    try:
        from PIL import Image, ImageDraw, ImageFont

        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Draw rounded rectangle background
        draw.rounded_rectangle(
            [(0, 0), (size - 1, size - 1)],
            radius=int(corner_r),
            fill=BG_COLOR
        )

        # Try Devanagari font for ॐ
        font_paths = [
            "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
            "/System/Library/Fonts/Supplemental/DevanagariMT.ttc",
            "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
            "/System/Library/Fonts/Apple Symbols.ttf",
        ]
        font = None
        for fp in font_paths:
            try:
                font_size = int(size * 0.52)
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                continue

        symbol = "ॐ"
        if font:
            bbox = draw.textbbox((0, 0), symbol, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            tx = (size - tw) // 2 - bbox[0]
            ty = (size - th) // 2 - bbox[1]
            ty -= int(size * 0.04)  # slight upward nudge

            # Draw with emerald gradient by drawing multiple times with slight offset
            # Simplified: draw in solid emerald-400
            draw.text((tx, ty), symbol, font=font, fill=EMERALD_START[:3] + (255,))
        else:
            # Fallback: draw a simple circle with "Om" text
            draw.ellipse(
                [(size * 0.2, size * 0.2), (size * 0.8, size * 0.8)],
                outline=EMERALD_START[:3],
                width=max(2, size // 32)
            )

        return list(img.getdata())

    except ImportError:
        pass

    # Pure Python fallback — solid rounded square with emerald dot
    result = []
    for y in range(size):
        for x in range(size):
            if in_rounded_rect(x, y, size, size, corner_r):
                # Gradient dot in center
                d = distance(x, y, cx, cy) / (size * 0.25)
                if d <= 1.0:
                    t = d
                    color = lerp_color(EMERALD_START, EMERALD_END, t)
                    result.append(color)
                else:
                    result.append(BG_COLOR)
            else:
                result.append((0, 0, 0, 0))
    return result


def generate_template_icon(size: int) -> list:
    """Generate a monochrome white ॐ on transparent background (menu bar template)."""
    try:
        from PIL import Image, ImageDraw, ImageFont

        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        font_paths = [
            "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
            "/System/Library/Fonts/Supplemental/DevanagariMT.ttc",
            "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
        ]
        font = None
        for fp in font_paths:
            try:
                font_size = int(size * 0.80)
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                continue

        symbol = "ॐ"
        if font:
            bbox = draw.textbbox((0, 0), symbol, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            tx = (size - tw) // 2 - bbox[0]
            ty = (size - th) // 2 - bbox[1]
            draw.text((tx, ty), symbol, font=font, fill=(0, 0, 0, 255))

        return list(img.getdata())

    except ImportError:
        pass

    # Fallback
    result = []
    cx2, cy2 = size / 2, size / 2
    for y in range(size):
        for x in range(size):
            d = distance(x, y, cx2, cy2) / (size * 0.35)
            if d <= 1.0:
                result.append(WHITE)
            else:
                result.append((0, 0, 0, 0))
    return result


def save_with_pillow(pixels_data, size, filepath):
    """Use Pillow to save if available."""
    try:
        from PIL import Image
        img = Image.new("RGBA", (size, size))
        img.putdata(pixels_data)
        img.save(str(filepath))
        return True
    except ImportError:
        return False


def main():
    print("Generating OmWhisper icons...")

    # Generate main icon at 1024x1024
    print("  Generating 1024×1024 source icon...")
    pixels = generate_icon(1024)

    source_icon = ICONS_DIR / "icon.png"
    if not save_with_pillow(pixels, 1024, source_icon):
        save_png(pixels, 1024, 1024, source_icon)
    print(f"  Saved {source_icon}")

    # Generate each required size
    sizes = [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
    ]

    for size, name in sizes:
        print(f"  Generating {name}...")
        try:
            from PIL import Image
            img = Image.open(str(source_icon)).resize((size, size), Image.LANCZOS)
            img.save(str(ICONS_DIR / name))
        except ImportError:
            px = generate_icon(size)
            out = ICONS_DIR / name
            if not save_with_pillow(px, size, out):
                save_png(px, size, size, out)
        print(f"  Saved {name}")

    # Generate monochrome template icon for menu bar (18x18 and 36x36 @2x)
    for size, name in [(18, "tray-icon.png"), (36, "tray-icon@2x.png")]:
        print(f"  Generating {name}...")
        px = generate_template_icon(size)
        out = ICONS_DIR / name
        if not save_with_pillow(px, size, out):
            save_png(px, size, size, out)
        print(f"  Saved {name}")

    # Generate icon.icns from icon.png using sips + iconutil
    print("  Generating icon.icns via iconutil...")
    iconset_dir = ICONS_DIR / "icon.iconset"
    iconset_dir.mkdir(exist_ok=True)

    try:
        from PIL import Image
        base = Image.open(str(source_icon))

        icns_sizes = [
            (16, "icon_16x16.png"),
            (32, "icon_16x16@2x.png"),
            (32, "icon_32x32.png"),
            (64, "icon_32x32@2x.png"),
            (128, "icon_128x128.png"),
            (256, "icon_128x128@2x.png"),
            (256, "icon_256x256.png"),
            (512, "icon_256x256@2x.png"),
            (512, "icon_512x512.png"),
            (1024, "icon_512x512@2x.png"),
        ]

        for sz, fname in icns_sizes:
            resized = base.resize((sz, sz), Image.LANCZOS)
            resized.save(str(iconset_dir / fname))

        result = subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(ICONS_DIR / "icon.icns")],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            print("  Saved icon.icns")
        else:
            print(f"  iconutil warning: {result.stderr}")

        # Clean up iconset
        import shutil
        shutil.rmtree(str(iconset_dir))

    except ImportError:
        print("  Skipping .icns generation (Pillow not available)")

    print("\nDone! Icons written to src-tauri/icons/")


if __name__ == "__main__":
    main()
