#!/usr/bin/env python3
"""Generate macOS menu-bar tray template icons for AX Code Desktop.

Outputs black-on-transparent PNGs (1x + @2x) under resources/icons/tray/.
Electron marks them as template images at runtime so macOS tints them.

Requires: Pillow (pip install Pillow / system python3 with PIL).
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "icons" / "tray"
STATUS = OUT / "status"
BREATH_FRAMES = 16


def draw_outline(size: int, fill_alpha: float = 0.0) -> Image.Image:
    """Rounded square + simple cross glyph; optional inner fill for breath animation."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = max(2, size // 7)
    r = max(3, size // 5)
    stroke = max(2, int(size * 0.14))
    black = (0, 0, 0, 255)

    for i in range(stroke):
        inset = m + i
        d.rounded_rectangle(
            [inset, inset, size - inset - 1, size - inset - 1],
            radius=max(1, r - i // 2),
            outline=black,
        )

    cx = cy = size // 2
    bar_w = max(2, size // 10)
    d.rectangle(
        [cx - bar_w // 2, m + stroke + size // 12, cx + bar_w // 2, size - m - stroke - size // 12],
        fill=black,
    )
    hw = size // 5
    d.rectangle([cx - hw, cy - bar_w // 2, cx + hw, cy + bar_w // 2], fill=black)

    if fill_alpha > 0:
        a = int(255 * max(0.0, min(1.0, fill_alpha)))
        fill = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        fd = ImageDraw.Draw(fill)
        inset = m + stroke
        fd.rounded_rectangle(
            [inset, inset, size - inset - 1, size - inset - 1],
            radius=max(1, r - stroke),
            fill=(0, 0, 0, a),
        )
        img = Image.alpha_composite(img, fill)
        d = ImageDraw.Draw(img)
        d.rectangle(
            [cx - bar_w // 2, m + stroke + size // 12, cx + bar_w // 2, size - m - stroke - size // 12],
            fill=black,
        )
        d.rectangle([cx - hw, cy - bar_w // 2, cx + hw, cy + bar_w // 2], fill=black)

    return img


def draw_status(size: int, kind: str) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    black = (0, 0, 0, 255)
    m = 2
    if kind == "blank":
        return img
    if kind == "busy":
        d.ellipse([m, m, size - m - 1, size - m - 1], fill=black)
    elif kind == "retry":
        d.ellipse([m, m, size - m - 1, size - m - 1], outline=black, width=max(1, size // 6))
        d.pieslice([m, m, size - m - 1, size - m - 1], start=200, end=340, fill=black)
    elif kind == "error":
        d.polygon([(size // 2, m), (size - m - 1, size - m - 1), (m, size - m - 1)], fill=black)
    elif kind == "unseen":
        d.rounded_rectangle([m, m, size - m - 1, size - m - 1], radius=size // 4, fill=black)
    return img


def save_pair(name: str, maker) -> None:
    maker(22).save(OUT / f"{name}.png")
    maker(44).save(OUT / f"{name}@2x.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    STATUS.mkdir(parents=True, exist_ok=True)

    save_pair("trayTemplate-idle", lambda s: draw_outline(s, 0.0))
    save_pair("trayTemplate-unseen", lambda s: draw_outline(s, 0.85))

    for i in range(BREATH_FRAMES):
        t = i / (BREATH_FRAMES - 1)
        ease = t * t * (3 - 2 * t)
        stem = f"trayTemplate-breath-{i:02d}"
        save_pair(stem, lambda s, a=ease: draw_outline(s, a))

    for kind in ("busy", "retry", "error", "unseen", "blank"):
        draw_status(16, kind).save(STATUS / f"{kind}.png")
        draw_status(32, kind).save(STATUS / f"{kind}@2x.png")

    print(f"generated tray icons under {OUT}")


if __name__ == "__main__":
    main()
