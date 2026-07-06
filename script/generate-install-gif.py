#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images" / "install-homebrew-ax-code.gif"
WIDTH = 1100
HEIGHT = 620


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_TITLE = font(28, bold=True)
FONT_BODY = font(22)
FONT_SMALL = font(20)

BG = "#0B0F14"
PANEL = "#111820"
CHROME = "#26313D"
TEXT = "#DDE7F0"
MUTED = "#8B9AAD"
LABEL = "#7AB7FF"
PROMPT = "#7CE38B"
SUCCESS = "#8BF6C1"
BLUE = "#7AB7FF"


lines: list[tuple[str, str]] = [
    ("title", "Install AX Code on macOS"),
    ("muted", "Open Terminal, install Homebrew, then install AX Code with Homebrew."),
    ("prompt", 'alex@MacBook-Pro ~ % /bin/bash -c "$(curl -fsSL'),
    ("shell", '  https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'),
    ("muted", "==> Installing Homebrew..."),
    ("success", "==> Installation successful"),
    ("prompt", "alex@MacBook-Pro ~ % brew tap defai-digital/ax-code"),
    ("prompt", "alex@MacBook-Pro ~ % brew tap defai-digital/ax-code-desktop"),
    ("prompt", "alex@MacBook-Pro ~ % brew trust defai-digital/ax-code"),
    ("prompt", "alex@MacBook-Pro ~ % brew trust defai-digital/ax-code-desktop"),
    ("prompt", "alex@MacBook-Pro ~ % brew install defai-digital/ax-code/ax-code"),
    ("prompt", "alex@MacBook-Pro ~ % brew install --cask defai-digital/ax-code-desktop/ax-code"),
    ("success", "AX Code is installed. Run ax-code to start the terminal UI."),
]


def draw_wrapped(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], fill: str, max_width: int) -> int:
    x, y = xy
    words = text.split(" ")
    current = ""
    line_height = 28
    for word in words:
        probe = word if not current else f"{current} {word}"
        if draw.textlength(probe, font=FONT_BODY) <= max_width:
            current = probe
            continue
        draw.text((x, y), current, font=FONT_BODY, fill=fill)
        y += line_height
        current = word
    if current:
        draw.text((x, y), current, font=FONT_BODY, fill=fill)
        y += line_height
    return y


def render(count: int, cursor: bool) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((34, 34, WIDTH - 34, HEIGHT - 34), radius=10, fill=PANEL)
    draw.rounded_rectangle((34, 34, WIDTH - 34, 76), radius=10, fill=CHROME)
    draw.rectangle((34, 64, WIDTH - 34, 76), fill=CHROME)
    draw.ellipse((55, 49, 69, 63), fill="#FF5F57")
    draw.ellipse((79, 49, 93, 63), fill="#FFBD2E")
    draw.ellipse((103, 49, 117, 63), fill="#28C840")
    draw.text((150, 48), "Terminal", font=FONT_SMALL, fill=MUTED)

    y = 108
    for kind, text in lines[:count]:
        if kind == "title":
            draw.text((72, y), text, font=FONT_TITLE, fill=LABEL)
            y += 42
            continue
        if kind == "muted":
            y = draw_wrapped(draw, text, (72, y), MUTED, WIDTH - 144)
            y += 10
            continue
        if kind == "success":
            y = draw_wrapped(draw, text, (72, y), SUCCESS, WIDTH - 144)
            y += 10
            continue

        prompt_marker = " % "
        if prompt_marker in text:
            before, after = text.split(prompt_marker, 1)
            draw.text((72, y), f"{before}{prompt_marker}", font=FONT_BODY, fill=PROMPT)
            command_x = 72 + int(draw.textlength(f"{before}{prompt_marker}", font=FONT_BODY))
            draw.text((command_x, y), after, font=FONT_BODY, fill=TEXT)
        else:
            draw.text((72, y), text, font=FONT_BODY, fill=TEXT if kind == "shell" else BLUE)
        y += 34

    if cursor and count < len(lines):
        draw.rectangle((72, y + 4, 84, y + 26), fill=SUCCESS)

    return image


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames: list[Image.Image] = []
    durations: list[int] = []

    for count in range(1, len(lines) + 1):
        frames.append(render(count, cursor=False))
        durations.append(700 if count < len(lines) else 1800)
        if count not in (1, 2, len(lines)):
            frames.append(render(count, cursor=True))
            durations.append(180)
            frames.append(render(count, cursor=False))
            durations.append(180)

    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
