"""Verify the generated book logo across Windows and frontend artwork."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = ROOT.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "assets"
FRONTEND_PUBLIC = REPOSITORY_ROOT / "frontend" / "public"
REQUIRED_SIZES = {16, 20, 24, 32, 40, 48, 64, 128, 256}


def inspect_artwork(rgba: Image.Image, label: str) -> tuple[float, float]:
    width, height = rgba.size
    alpha = rgba.getchannel("A")
    visible_alpha = alpha.point(lambda value: 255 if value >= 64 else 0)
    alpha_bounds = visible_alpha.getbbox()
    if alpha_bounds is None:
        raise RuntimeError(f"{label} has no visible blue book mark.")
    if alpha.getpixel((0, 0)) >= 64:
        raise RuntimeError(f"{label} must remain frameless with transparent corners.")
    mark_bounds = alpha_bounds
    left, top, right, bottom = mark_bounds
    if left <= 0 or top <= 0 or right >= width or bottom >= height:
        raise RuntimeError(f"{label} book mark is clipped: {mark_bounds}.")
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    if abs(center_x - width / 2) > width * 0.1:
        raise RuntimeError(f"{label} book mark is not horizontally centered: {mark_bounds}.")
    if abs(center_y - height / 2) > height * 0.1:
        raise RuntimeError(f"{label} book mark is not vertically centered: {mark_bounds}.")
    if sum(1 for value in visible_alpha.getdata() if value) < max(4, round(width * height * 0.06)):
        raise RuntimeError(f"{label} book mark lacks enough high-contrast pixels.")
    return ((right - left) / width, (bottom - top) / height)


def check_png(path: Path, expected_size: tuple[int, int]) -> None:
    with Image.open(path) as image:
        if image.size != expected_size:
            raise RuntimeError(f"{path.name} is {image.size}, expected {expected_size}.")
        inspect_artwork(image.convert("RGBA"), path.name)


def check_ico(path: Path) -> dict[int, tuple[float, float]]:
    with Image.open(path) as image:
        available = {width for width, height in image.ico.sizes() if width == height}
        missing = sorted(REQUIRED_SIZES - available)
        if missing:
            raise RuntimeError(f"{path.name} is missing ICO frames: {missing}.")
        if max(available) != 256:
            raise RuntimeError(f"{path.name} must include Windows' maximum 256x256 frame.")
        return {
            size: inspect_artwork(image.ico.getimage((size, size)).convert("RGBA"), f"{path.name} {size}px")
            for size in sorted(REQUIRED_SIZES)
        }


check_png(ASSETS / "icon.png", (1024, 1024))
check_png(ASSETS / "tray-icon.png", (512, 512))
check_png(FRONTEND_PUBLIC / "brand-icon.png", (1024, 1024))
check_png(FRONTEND_PUBLIC / "favicon.png", (256, 256))

with Image.open(ASSETS / "logo-master.png") as master:
    if master.width != master.height or min(master.size) < 1024:
        raise RuntimeError(f"logo-master.png must remain square and at least 1024px; got {master.size}.")

with Image.open(FRONTEND_PUBLIC / "brand-mark.png") as mark_image:
    mark = mark_image.convert("RGBA")
    if mark.size != (1024, 1024):
        raise RuntimeError(f"brand-mark.png is {mark.size}, expected (1024, 1024).")
    alpha_bounds = mark.getchannel("A").getbbox()
    if alpha_bounds is None or alpha_bounds[0] <= 0 or alpha_bounds[1] <= 0 or alpha_bounds[2] >= 1024 or alpha_bounds[3] >= 1024:
        raise RuntimeError(f"brand-mark.png must have transparent safety margins: {alpha_bounds}.")

with Image.open(ASSETS / "logo-mark-blue.png") as splash_mark_image:
    splash_mark = splash_mark_image.convert("RGBA")
    if splash_mark.size != (1024, 1024):
        raise RuntimeError(f"logo-mark-blue.png is {splash_mark.size}, expected (1024, 1024).")
    alpha_bounds = splash_mark.getchannel("A").getbbox()
    if alpha_bounds is None or alpha_bounds[0] <= 0 or alpha_bounds[1] <= 0 or alpha_bounds[2] >= 1024 or alpha_bounds[3] >= 1024:
        raise RuntimeError(f"logo-mark-blue.png must have transparent safety margins: {alpha_bounds}.")
    if splash_mark.getpixel((0, 0))[3] != 0:
        raise RuntimeError("logo-mark-blue.png must not contain a surrounding background frame.")

app_metrics = check_ico(BUILD / "icon.ico")
for icon_path in (
    BUILD / "installerIcon.ico",
    BUILD / "uninstallerIcon.ico",
):
    if check_ico(icon_path) != app_metrics:
        raise RuntimeError(f"{icon_path.name} does not match the application ICO.")

tray_metrics = check_ico(ASSETS / "tray-icon.ico")
for size in REQUIRED_SIZES:
    app_width, app_height = app_metrics[size]
    tray_width, tray_height = tray_metrics[size]
    tolerance = 1 / size
    if abs(app_width - tray_width) > tolerance or abs(app_height - tray_height) > tolerance:
        raise RuntimeError(f"Application and tray book-mark proportions differ at {size}px.")
    if app_width < 0.80:
        raise RuntimeError(f"Book mark is too small at {size}px: width ratio {app_width:.3f}.")

print("Frameless blue book branding verified at 16, 20, 24, 32, 40, 48, 64, 128, and 256px: transparent corners, maximum safe size, centered unclipped mark, identical app/tray proportions, and clear contrast.")
