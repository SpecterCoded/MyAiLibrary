"""Generate all desktop and frontend artwork from the selected book-logo master."""

from __future__ import annotations

import base64
import io
import shutil
from math import sqrt
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = ROOT.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "assets"
FRONTEND_PUBLIC = REPOSITORY_ROOT / "frontend" / "public"
MASTER = ASSETS / "logo-master.png"
ICON_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]
MARK_WIDTH_RATIO = 0.90
ICON_MARK_WIDTH_RATIO = 0.90

BUILD.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)
FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)


def brand_gradient(size: tuple[int, int], mode: str = "RGB") -> Image.Image:
    """Recreate the selected electric-blue/indigo background without raster artifacts."""
    width, height = size
    image = Image.new(mode, size)
    pixels = image.load()
    start = (0, 77, 253)
    end = (29, 10, 158)

    for y in range(height):
        vertical = y / max(1, height - 1)
        for x in range(width):
            horizontal = x / max(1, width - 1)
            progress = min(1.0, max(0.0, (horizontal * 0.64 + vertical * 0.36) ** 0.88))
            glow_distance = sqrt(((horizontal - 0.18) / 0.95) ** 2 + ((vertical - 0.24) / 0.95) ** 2)
            glow = max(0.0, 1.0 - glow_distance) * 14
            rgb = (
                round(start[0] + (end[0] - start[0]) * progress),
                round(start[1] + (end[1] - start[1]) * progress),
                min(255, round(start[2] + (end[2] - start[2]) * progress + glow)),
            )
            pixels[x, y] = (*rgb, 255) if mode == "RGBA" else rgb
    return image


def extract_book_mark() -> Image.Image:
    """Extract a clean antialiased white mark from the approved generated master."""
    if not MASTER.is_file():
        raise RuntimeError(f"Selected logo master is missing: {MASTER}")

    with Image.open(MASTER) as source:
        source = source.convert("RGB")
        if source.width != source.height or min(source.size) < 1024:
            raise RuntimeError(f"Logo master must be a square image of at least 1024px; got {source.size}.")
        red, green, blue = source.split()
        minimum_channel = ImageChops.darker(red, ImageChops.darker(green, blue))

    cutoff = 22
    opaque = 238
    alpha = minimum_channel.point(
        lambda value: 0 if value <= cutoff else 255 if value >= opaque else round((value - cutoff) * 255 / (opaque - cutoff))
    )
    bounds = alpha.getbbox()
    if bounds is None:
        raise RuntimeError("The selected logo master does not contain a white book mark.")

    mark = Image.new("RGBA", source.size, (255, 255, 255, 0))
    mark.putalpha(alpha)
    return mark.crop(bounds)


BOOK_MARK = extract_book_mark()


def render_icon(size: int, mark_width_ratio: float = ICON_MARK_WIDTH_RATIO) -> Image.Image:
    """Render only the large blue book mark on transparency."""
    return render_blue_transparent_mark(size, mark_width_ratio)


def render_transparent_mark(size: int, mark_width_ratio: float = MARK_WIDTH_RATIO) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    target_width = max(1, round(size * mark_width_ratio))
    target_height = max(1, round(target_width * BOOK_MARK.height / BOOK_MARK.width))
    mark = BOOK_MARK.resize((target_width, target_height), Image.Resampling.LANCZOS)
    left = round((size - target_width) / 2)
    top = round(size * 0.51 - target_height / 2)
    canvas.alpha_composite(mark, (left, top))
    return canvas


def render_blue_transparent_mark(size: int, mark_width_ratio: float = 0.84) -> Image.Image:
    """Render the book itself in the brand gradient with no surrounding frame."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    target_width = max(1, round(size * mark_width_ratio))
    target_height = max(1, round(target_width * BOOK_MARK.height / BOOK_MARK.width))
    mark_alpha = BOOK_MARK.resize((target_width, target_height), Image.Resampling.LANCZOS).getchannel("A")
    colored_mark = brand_gradient((target_width, target_height), mode="RGBA")
    colored_mark.putalpha(mark_alpha)
    left = round((size - target_width) / 2)
    top = round(size * 0.51 - target_height / 2)
    canvas.alpha_composite(colored_mark, (left, top))
    return canvas


def write_embedded_svg(icon: Image.Image, destination: Path) -> None:
    buffer = io.BytesIO()
    icon.save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    destination.write_text(
        "\n".join([
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="MyAiLibrary">',
            f'  <image width="1024" height="1024" href="data:image/png;base64,{encoded}"/>',
            "</svg>",
            "",
        ]),
        encoding="utf-8",
    )


app_icon = render_icon(1024)
app_icon.save(ASSETS / "icon.png", optimize=True)
app_icon.save(BUILD / "icon.ico", sizes=ICON_SIZES)
shutil.copyfile(BUILD / "icon.ico", BUILD / "installerIcon.ico")
shutil.copyfile(BUILD / "icon.ico", BUILD / "uninstallerIcon.ico")

# Windows controls the physical notification-area slot. Supplying every useful
# ICO frame from the exact application ICO keeps frame and mark proportions
# identical while filling the maximum safe area at every DPI.
tray_icon = render_icon(512)
tray_icon.save(ASSETS / "tray-icon.png", optimize=True)
shutil.copyfile(BUILD / "icon.ico", ASSETS / "tray-icon.ico")

frontend_icon = app_icon.copy()
frontend_mark = render_transparent_mark(1024)
blue_splash_mark = render_blue_transparent_mark(1024)
frontend_icon.save(FRONTEND_PUBLIC / "brand-icon.png", optimize=True)
frontend_mark.save(FRONTEND_PUBLIC / "brand-mark.png", optimize=True)
blue_splash_mark.save(ASSETS / "logo-mark-blue.png", optimize=True)
frontend_icon.resize((256, 256), Image.Resampling.LANCZOS).save(FRONTEND_PUBLIC / "favicon.png", optimize=True)
write_embedded_svg(app_icon, ASSETS / "logo.svg")

installer_sidebar = Image.new("RGB", (164, 314))
sidebar_pixels = installer_sidebar.load()
for y in range(installer_sidebar.height):
    progress = y / max(1, installer_sidebar.height - 1)
    color = tuple(round(start + (end - start) * progress) for start, end in zip((14, 18, 33), (31, 41, 72)))
    for x in range(installer_sidebar.width):
        sidebar_pixels[x, y] = color
sidebar_mark = app_icon.resize((124, 124), Image.Resampling.LANCZOS)
installer_sidebar.paste(sidebar_mark, (20, 32), sidebar_mark)
ImageDraw.Draw(installer_sidebar).rounded_rectangle((22, 186, 142, 190), 2, fill=(99, 102, 241))
installer_sidebar.save(BUILD / "installerSidebar.bmp")

installer_header = Image.new("RGB", (150, 57), (248, 250, 252))
header_mark = app_icon.resize((52, 52), Image.Resampling.LANCZOS)
installer_header.paste(header_mark, (95, 2), header_mark)
installer_header.save(BUILD / "installerHeader.bmp")

print(f"Generated book-logo branding from {MASTER}")
