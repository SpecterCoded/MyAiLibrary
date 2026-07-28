"""Verify generated Windows application and tray artwork."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "assets"
REQUIRED_SIZES = {16, 20, 24, 32, 48, 128, 256}


def inspect_artwork(rgba: Image.Image, label: str) -> tuple[float, float]:
    width, height = rgba.size
    alpha_bounds = rgba.getchannel("A").getbbox()
    if alpha_bounds != (0, 0, width, height):
        raise RuntimeError(f"{label} does not use the full canvas: {alpha_bounds}.")

    white = Image.new("L", rgba.size)
    white.putdata([
        255 if alpha >= 128 and red >= 235 and green >= 235 and blue >= 235 else 0
        for red, green, blue, alpha in rgba.getdata()
    ])
    mark_bounds = white.getbbox()
    if mark_bounds is None:
        raise RuntimeError(f"{label} has no white sparkle mark.")
    left, top, right, bottom = mark_bounds
    if left <= 0 or top <= 0 or right >= width or bottom >= height:
        raise RuntimeError(f"{label} sparkle mark is clipped: {mark_bounds}.")
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    if abs(center_x - width / 2) > width * 0.1:
        raise RuntimeError(f"{label} sparkle is not horizontally centered: {mark_bounds}.")
    if abs(center_y - height / 2) > height * 0.1:
        raise RuntimeError(f"{label} sparkle is not vertically centered: {mark_bounds}.")
    if sum(1 for value in white.getdata() if value) < max(4, round(width * height * 0.06)):
        raise RuntimeError(f"{label} sparkle lacks enough high-contrast pixels.")
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
        raise RuntimeError(f"Application and tray sparkle proportions differ at {size}px.")

print("Branding verified at 16, 20, 24, 32, 48, 128, and 256px: full canvas, centered unclipped mark, matching proportions, and clear contrast.")
