"""Generate temporary Windows/NSIS artwork. Replace by rerunning with final brand art."""

from __future__ import annotations

import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "assets"
BUILD.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)


def gradient(size: tuple[int, int], start=(56, 189, 248), end=(129, 140, 248)) -> Image.Image:
    image = Image.new("RGB", size)
    pixels = image.load()
    width, height = size
    for y in range(height):
        for x in range(width):
            t = (x / max(1, width - 1) + y / max(1, height - 1)) / 2
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(start, end))
    return image


def draw_mark(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = round(size * 0.06)
    radius = round(size * 0.23)
    draw.rounded_rectangle((margin, margin, size - margin, size - margin), radius, fill=(16, 24, 39, 255))
    stroke = max(2, round(size * 0.055))
    center = size // 2
    top, bottom = round(size * 0.29), round(size * 0.75)
    left, right = round(size * 0.27), round(size * 0.73)
    accent = (103, 157, 249, 255)
    draw.line((left, top, center, round(size * 0.34), center, bottom), fill=accent, width=stroke, joint="curve")
    draw.line((right, top, center, round(size * 0.34)), fill=accent, width=stroke)
    draw.line((left, top, left, round(size * 0.68), center, bottom), fill=accent, width=stroke, joint="curve")
    draw.line((right, top, right, round(size * 0.68), center, bottom), fill=accent, width=stroke, joint="curve")
    return image


mark = draw_mark(1024)
mark.save(ASSETS / "icon.png", optimize=True)
mark.save(BUILD / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
shutil.copyfile(BUILD / "icon.ico", BUILD / "installerIcon.ico")
shutil.copyfile(BUILD / "icon.ico", BUILD / "uninstallerIcon.ico")

sidebar = gradient((164, 314), (8, 12, 22), (35, 49, 80))
sidebar_mark = mark.resize((104, 104), Image.Resampling.LANCZOS)
sidebar.paste(sidebar_mark, (30, 42), sidebar_mark)
ImageDraw.Draw(sidebar).rounded_rectangle((22, 186, 142, 190), 2, fill=(91, 150, 246))
sidebar.save(BUILD / "installerSidebar.bmp")

header = gradient((150, 57), (16, 24, 39), (45, 57, 86))
header_mark = mark.resize((46, 46), Image.Resampling.LANCZOS)
header.paste(header_mark, (96, 5), header_mark)
header.save(BUILD / "installerHeader.bmp")

print(f"Generated temporary branding in {BUILD}")
