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

The Updates tab and GitHub Releases provider are configured, but ordinary engineering builds keep `updatesEnabled` set to `false`. This prevents an unsigned build from installing updates.

Production releases are created only by the tagged Windows release workflow. It requires `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` repository secrets, verifies the resulting Authenticode signature, and changes `updatesEnabled` to `true` only inside the release runner. Certificate material and GitHub publishing tokens must never be committed.

Before installing a downloaded update, Electron stops the backend and invokes its offline maintenance mode. The helper checkpoints and backs up SQLite plus desktop configuration, verifies database integrity and SHA-256 hashes, and writes the completed snapshot beneath `%LOCALAPPDATA%\MyAILibrary\backups\pre-update`. A failed safety gate cancels installation and restarts the existing backend.

For UI testing without a published release, set `MYAI_UPDATE_SIMULATION` to `available`, `downloading`, `ready`, or `installed` before running `npm run dev`. Simulation never contacts an update server or enables installation.

For an actual local installer replacement test without a signing certificate, build specially marked engineering installers with `npm run build:test-update -- -Version 0.1.2` and `npm run build:test-update -- -Version 0.1.3 -SkipApplicationBuild`. Serve the newer version with `npm run serve:test-update -- -Version 0.1.3`, then use `npm run launch:test-update` from a second terminal to start the installed baseline with the required test environment. The updater accepts this mode only when the package contains `updatesTestMode=true`, and it rejects every feed that is not loopback HTTP. Ordinary and production packages retain `updatesTestMode=false` and cannot enable this channel through environment variables.

Every packaged version must have `release-notes/<version>.md`. Both the engineering build helper and signed GitHub release workflow fail when the matching file is missing. electron-builder embeds these notes into update metadata so the Updates tab can show them before download and again after a successful restart.

Unsigned GitHub previews use the separate Testing channel. Beta tags must use a version such as `v0.1.4-beta.1` and have a matching Markdown file. The unsigned Beta workflow marks only those installers with `updatesTestingEnabled=true`, publishes them as GitHub prereleases on the `beta` channel, disables Authenticode verification only for that workflow, and retains electron-builder checksum verification plus the normal pre-update backup gate. Users must explicitly enable Testing in Settings. Stable packages never inherit this permission and remain signed-only.
