# My AI Library Desktop

This package supervises the local FastAPI process and packages the React UI as a Windows x64 Electron application.

## Developer setup

1. Use Node.js 22 or newer and run `npm install` in both `frontend` and `desktop`.
2. Install packaging tools with `backend\venv\Scripts\python.exe -m pip install -r backend\requirements-build.txt`.
3. Run `npm run dev` in `desktop` for Vite + Electron development.
4. Run `npm run pack` for an unpacked smoke-test build or `npm run dist` for NSIS.

`npm run dev` starts the source backend on `127.0.0.1:8000`. Packaged builds select a random loopback port.

## Branding

The checked-in artwork is temporary. Put the final master logo into the branding workflow and rerun `scripts/generate-branding.py`, preserving the configured ICO/BMP output sizes.

## FFmpeg

Before packaging, populate `vendor/ffmpeg` with an x64 LGPL-compatible Windows distribution containing `bin\ffmpeg.exe`, `bin\ffprobe.exe`, and its license. The resource verification script intentionally fails if either executable is absent.

## Signing and updates

The test build is unsigned and unpublished. A future release can use `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`; no certificate material belongs in this repository. Add an electron-builder `publish` provider only when the update host is selected.
