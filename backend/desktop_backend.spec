# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules


hiddenimports = []
datas = []
binaries = []

for package in (
    "chromadb",
    "huggingface_hub",
    "sentence_transformers",
    "transformers",
    "wtpsplit",
    "youtube_transcript_api",
    "yt_dlp",
):
    hiddenimports += collect_submodules(package)
    datas += collect_data_files(package)

# Passlib resolves password hash handlers by registry name at runtime.
hiddenimports += collect_submodules("passlib.handlers")

for package in ("onnxruntime", "tokenizers", "torch"):
    binaries += collect_dynamic_libs(package)

a = Analysis(
    ["desktop_entry.py"],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "IPython",
        "jupyter",
        "matplotlib",
        "notebook",
        "pytest",
        "tkinter",
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="myailibrary-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="myailibrary-backend",
)
