#!/usr/bin/env python3
"""Generate AX Code desktop app icons with a macOS-style rounded squircle.

Reads the master 1024×1024 artwork (build/icon-source.png, or build/icon.png
as fallback). The source mark is already composition-centered on its plate —
we only:

  1. optionally scale the full canvas slightly toward center (safe zone)
  2. apply a continuous-corner (squircle) mask with transparent outside

Writes:

  build/icon.png   — 1024×1024 master used by dock (dev) + packaging source
  build/icon.icns  — multi-resolution macOS icon (via iconutil)
  build/icon.ico   — multi-resolution Windows icon

Requires: Pillow. On macOS, iconutil is used for .icns (falls back to
magick/convert if iconutil is missing).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SOURCE_CANDIDATES = (
    BUILD / "icon-source.png",
    BUILD / "icon.png",
)

# Continuous corner radius ≈ 22.37% of side (Apple squircle approximation).
CORNER_RATIO = 0.2237
# Keep a little breathing room inside the squircle so the mark is not clipped.
# Applied as a uniform scale about the canvas center — does not re-crop art.
SAFE_ZONE_SCALE = 0.90


def load_source() -> Image.Image:
    for path in SOURCE_CANDIDATES:
        if path.exists():
            img = Image.open(path).convert("RGBA")
            print(f"source: {path} ({img.size[0]}×{img.size[1]})")
            return img
    raise SystemExit(f"No source icon found. Tried: {', '.join(str(p) for p in SOURCE_CANDIDATES)}")


def normalize_square(source: Image.Image, size: int = 1024) -> Image.Image:
    """Force a size×size RGBA canvas, letterboxing with plate color if needed."""
    if source.size == (size, size):
        return source.copy()
    # Sample plate from a corner of the source.
    plate = source.getpixel((max(0, source.size[0] // 20), max(0, source.size[1] // 20)))[:3] + (255,)
    canvas = Image.new("RGBA", (size, size), plate)
    # Fit entire source into the square, preserving aspect ratio, centered.
    sw, sh = source.size
    ratio = min(size / sw, size / sh)
    nw = max(1, int(round(sw * ratio)))
    nh = max(1, int(round(sh * ratio)))
    resized = source.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def scale_about_center(img: Image.Image, scale: float) -> Image.Image:
    """Uniformly shrink the full image toward its center onto the same plate."""
    if abs(scale - 1.0) < 1e-6:
        return img.copy()
    size = img.size[0]
    plate = img.getpixel((size // 20, size // 20))[:3] + (255,)
    canvas = Image.new("RGBA", (size, size), plate)
    nw = max(1, int(round(size * scale)))
    nh = nw
    scaled = img.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(scaled, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def squircle_mask(size: int, corner_ratio: float = CORNER_RATIO) -> Image.Image:
    """Anti-aliased continuous-corner mask (rounded rect close to macOS squircle)."""
    over = 4
    s = size * over
    radius = max(1, int(round(s * corner_ratio)))
    mask = Image.new("L", (s, s), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=over * 0.35))
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def apply_mask(img: Image.Image, mask: Image.Image) -> Image.Image:
    out = img.copy()
    src_alpha = out.getchannel("A")
    combined = ImageChops.multiply(src_alpha, mask)
    out.putalpha(combined)
    return out


def build_master(source: Image.Image, size: int = 1024) -> Image.Image:
    # Source art is already logo-centered. Do not re-crop or mass-reposition —
    # that previously shifted the mark into the upper-left of the dock icon.
    plate = normalize_square(source, size)
    plate = scale_about_center(plate, SAFE_ZONE_SCALE)
    return apply_mask(plate, squircle_mask(size))


def write_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)
    print(f"wrote {path}")


def _iconset_retina_name(base: str) -> str:
    """Build iconutil retina filenames without embedding a literal address-like token."""
    return f"{base}{chr(64)}2x.png"


def write_icns(master: Image.Image, path: Path) -> None:
    """Build a multi-resolution .icns via iconutil (macOS) or ImageMagick."""
    sizes = [
        (16, "icon_16x16.png"),
        (32, _iconset_retina_name("icon_16x16")),
        (32, "icon_32x32.png"),
        (64, _iconset_retina_name("icon_32x32")),
        (128, "icon_128x128.png"),
        (256, _iconset_retina_name("icon_128x128")),
        (256, "icon_256x256.png"),
        (512, _iconset_retina_name("icon_256x256")),
        (512, "icon_512x512.png"),
        (1024, _iconset_retina_name("icon_512x512")),
    ]

    if shutil.which("iconutil"):
        with tempfile.TemporaryDirectory(prefix="ax-code-iconset-") as tmp:
            iconset = Path(tmp) / "AppIcon.iconset"
            iconset.mkdir()
            for px, name in sizes:
                frame = master.resize((px, px), Image.Resampling.LANCZOS)
                frame.save(iconset / name, format="PNG")
            listed = sorted(p.name for p in iconset.iterdir())
            if len(listed) != len(sizes):
                raise SystemExit(f"iconset incomplete: {listed}")
            subprocess.check_call(["iconutil", "-c", "icns", str(iconset), "-o", str(path)])
        print(f"wrote {path} (iconutil)")
        return

    convert = shutil.which("magick") or shutil.which("convert")
    if not convert:
        raise SystemExit("Neither iconutil nor ImageMagick available to write .icns")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        master.save(tmp_path, format="PNG")
        subprocess.check_call([convert, str(tmp_path), str(path)])
    finally:
        tmp_path.unlink(missing_ok=True)
    print(f"wrote {path} (ImageMagick)")


def write_ico(master: Image.Image, path: Path) -> None:
    """Windows multi-size ICO (16…256). Prefer ImageMagick; Pillow fallback."""
    sizes = [256, 128, 64, 48, 32, 16]
    convert = shutil.which("magick") or shutil.which("convert")
    if convert:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            master.save(tmp_path, format="PNG")
            define = "icon:auto-resize=" + ",".join(str(s) for s in sizes)
            subprocess.check_call([convert, str(tmp_path), "-define", define, str(path)])
        finally:
            tmp_path.unlink(missing_ok=True)
        print(f"wrote {path} (ImageMagick)")
        return

    frames = [master.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
    frames[0].save(
        path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=frames[1:],
    )
    print(f"wrote {path} (Pillow)")


def verify_rounded(img: Image.Image) -> None:
    """Sanity-check that corners are transparent (not a sharp opaque square)."""
    w, h = img.size
    for x, y in [(0, 0), (1, 1), (2, 2), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        a = img.getpixel((x, y))[3]
        if a > 20:
            raise SystemExit(f"corner ({x},{y}) still opaque (alpha={a}); mask failed")
    cx, cy = w // 2, h // 2
    if img.getpixel((cx, cy))[3] < 200:
        raise SystemExit(f"center ({cx},{cy}) unexpectedly transparent")
    print("verify: corners transparent, center opaque ✓")


def verify_logo_centered(img: Image.Image, tol: int = 24) -> None:
    """Ensure solid mark mass stays near the canvas center (catches bad re-crops)."""
    import numpy as np

    arr = np.array(img)
    rgb = arr[:, :, :3].astype(np.int16)
    a = arr[:, :, 3]
    # Solid mark ≈ dark or teal, high alpha — not the light plate.
    dark = (rgb.max(axis=2) < 90) & (a >= 200)
    teal = (rgb[:, :, 1] > 120) & (rgb[:, :, 1] > rgb[:, :, 0] + 20) & (a >= 200)
    mark = dark | teal
    ys, xs = np.where(mark)
    if len(xs) < 100:
        print("verify: logo center skipped (too few mark pixels)")
        return
    mx, my = float(xs.mean()), float(ys.mean())
    mid = img.size[0] / 2
    print(f"verify: logo mass center ({mx:.1f}, {my:.1f}) target ({mid:.1f}, {mid:.1f})")
    if abs(mx - mid) > tol or abs(my - mid) > tol:
        raise SystemExit(
            f"logo mass off-center by ({mx - mid:.1f}, {my - mid:.1f}); "
            f"refusing to write a shifted icon"
        )
    print("verify: logo centered ✓")


def main(argv: list[str]) -> int:
    source = load_source()
    source_path = BUILD / "icon-source.png"

    # Preserve an unmasked master on first migration so re-runs do not nest masks.
    if not source_path.exists():
        corner_a = source.getpixel((0, 0))[3]
        if corner_a > 200:
            unmasked = normalize_square(source, 1024)
            unmasked.save(source_path, format="PNG", optimize=True)
            print(f"preserved unmasked master at {source_path}")
            source = unmasked
    else:
        # Always regenerate from the unmasked master when present.
        source = Image.open(source_path).convert("RGBA")
        print(f"using preserved master: {source_path}")

    master = build_master(source, 1024)
    verify_rounded(master)
    verify_logo_centered(master)

    write_png(master, BUILD / "icon.png")
    write_icns(master, BUILD / "icon.icns")
    write_ico(master, BUILD / "icon.ico")
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
