"""Generate Windows/NSIS artwork from the in-app sidebar sparkle brand mark."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "assets"
BUILD.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)


def gradient(size: tuple[int, int], start=(37, 99, 235), end=(79, 70, 229), mode="RGB") -> Image.Image:
    image = Image.new(mode, size)
    pixels = image.load()
    width, height = size
    for y in range(height):
        for x in range(width):
            t = (x / max(1, width - 1) + y / max(1, height - 1)) / 2
            rgb = tuple(round(a + (b - a) * t) for a, b in zip(start, end))
            pixels[x, y] = (*rgb, 255) if mode == "RGBA" else rgb
    return image


def draw_gradient_rounded_rect(base: Image.Image, box: tuple[int, int, int, int], radius: int) -> None:
    x1, y1, x2, y2 = box
    rect = gradient((x2 - x1, y2 - y1), mode="RGBA")
    mask = Image.new("L", rect.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, rect.size[0] - 1, rect.size[1] - 1), radius, fill=255)
    base.paste(rect, (x1, y1), mask)


def _scale_point(point: tuple[float, float], icon_left: float, icon_top: float, scale: float) -> tuple[int, int]:
    return (round(icon_left + point[0] * scale), round(icon_top + point[1] * scale))


def draw_round_line(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], width: int, fill: tuple[int, int, int, int], closed=False) -> None:
    if closed:
        points = [*points, points[0]]
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width / 2
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def draw_lucide_sparkles(draw: ImageDraw.ImageDraw, size: int, icon_ratio: float = 0.84) -> None:
    # Sidebar source: <Sparkles className="w-5 h-5 text-white" strokeWidth={2} />
    # inside a 40x40 rounded-2xl gradient square.
    icon_size = size * icon_ratio
    icon_left = (size - icon_size) / 2
    icon_top = (size - icon_size) / 2
    scale = icon_size / 24
    stroke = max(2, round(2 * scale))
    white = (255, 255, 255, 255)

    main_shape = [
        (12.0, 2.814),
        (14.034, 9.966),
        (21.186, 12.0),
        (14.034, 14.034),
        (12.0, 21.186),
        (9.966, 14.034),
        (2.814, 12.0),
        (9.966, 9.966),
    ]
    draw_round_line(draw, [_scale_point(p, icon_left, icon_top, scale) for p in main_shape], stroke, white, closed=True)
    draw_round_line(draw, [_scale_point((20, 2), icon_left, icon_top, scale), _scale_point((20, 6), icon_left, icon_top, scale)], stroke, white)
    draw_round_line(draw, [_scale_point((18, 4), icon_left, icon_top, scale), _scale_point((22, 4), icon_left, icon_top, scale)], stroke, white)

    cx, cy = _scale_point((4, 20), icon_left, icon_top, scale)
    r = 2 * scale
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=white, width=stroke)


def draw_mark(size: int, *, radius_ratio: float = 0.4, icon_ratio: float = 0.84) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = 0
    radius = round(size * radius_ratio)
    draw_gradient_rounded_rect(image, (margin, margin, size - margin, size - margin), radius)
    draw_lucide_sparkles(draw, size, icon_ratio)
    return image


mark = draw_mark(1024)
mark.save(ASSETS / "icon.png", optimize=True)
mark.save(
    BUILD / "icon.ico",
    sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
)
shutil.copyfile(BUILD / "icon.ico", BUILD / "installerIcon.ico")
shutil.copyfile(BUILD / "icon.ico", BUILD / "uninstallerIcon.ico")

# The Windows notification area is physically tiny. A dedicated high-resolution
# mark with squarer corners and a larger sparkle uses substantially more of the
# available tray pixels than the full application artwork.
tray_mark = draw_mark(512, radius_ratio=0.26, icon_ratio=0.84)
tray_mark.save(ASSETS / "tray-icon.png", optimize=True)
tray_mark.save(
    ASSETS / "tray-icon.ico",
    sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
)

sidebar = gradient((164, 314), (14, 18, 33), (31, 41, 72))
sidebar_mark = mark.resize((104, 104), Image.Resampling.LANCZOS)
sidebar.paste(sidebar_mark, (30, 42), sidebar_mark)
ImageDraw.Draw(sidebar).rounded_rectangle((22, 186, 142, 190), 2, fill=(99, 102, 241))
sidebar.save(BUILD / "installerSidebar.bmp")

header = gradient((150, 57), (248, 250, 252), (226, 232, 240))
header_mark = mark.resize((46, 46), Image.Resampling.LANCZOS)
header.paste(header_mark, (96, 5), header_mark)
header.save(BUILD / "installerHeader.bmp")

print(f"Generated temporary branding in {BUILD}")
